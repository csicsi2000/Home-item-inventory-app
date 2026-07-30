import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MlStage } from '$lib/db/types';

// Shared recorder the mocked pipeline writes to. vi.hoisted so the vi.mock
// factory (hoisted above imports) can safely close over it.
const h = vi.hoisted(() => ({
	calls: [] as string[],
	resolvers: [] as Array<(failed?: string[]) => void>,
	stagesSeen: [] as string[][]
}));

vi.mock('./pipeline', () => ({
	ALL_STAGES: ['barcode', 'ocr', 'embedding'],
	runPostSavePipeline: (itemId: string, _photoId: string, stages: string[]) => {
		h.calls.push(`start:${itemId}`);
		h.stagesSeen.push(stages);
		return new Promise((resolve) => {
			h.resolvers.push((failed: string[] = []) => {
				h.calls.push(`end:${itemId}`);
				resolve({
					completed: stages.filter((s) => !failed.includes(s)),
					failed: failed.map((stage) => ({ stage, error: new Error('boom') }))
				});
			});
		});
	}
}));

import { db } from '$lib/db/schema';
import { processQueue } from './queue.svelte';

/**
 * Let the queue settle. Enqueue and drain are now several Dexie round trips
 * deep, so a single macrotask isn't enough.
 */
const flush = async () => {
	for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
};

/** Jobs are dropped when their item or photo is gone, so seed real rows. */
async function seed(itemId: string, photoId: string) {
	const t = '2026-01-01T00:00:00.000Z';
	await db.items.put({
		id: itemId,
		collectionId: 'c1',
		name: '',
		description: null,
		quantity: 1,
		status: 'owned',
		condition: null,
		tags: [],
		barcode: null,
		ocrText: null,
		acquisitionPrice: null,
		acquisitionDate: null,
		soldPrice: null,
		soldDate: null,
		currency: null,
		customFields: {},
		createdAt: t,
		updatedAt: t,
		deletedAt: null,
		dirty: 0
	});
	await db.photos.put({
		id: photoId,
		itemId,
		blob: null,
		thumb: null,
		storagePath: null,
		uploaded: 0,
		isPrimary: true,
		width: 1,
		height: 1,
		createdAt: t,
		updatedAt: t,
		deletedAt: null,
		dirty: 0
	});
}

// The queue is a singleton and runs strictly one job at a time, so a test that
// leaves a pipeline unresolved would block every test after it.
afterEach(async () => {
	while (h.resolvers.length) h.resolvers.shift()!();
	await flush();
});

beforeEach(async () => {
	await Promise.all(db.tables.map((t) => t.clear()));
	h.calls = [];
	h.resolvers = [];
	h.stagesSeen = [];
});

describe('processQueue', () => {
	it('runs one pipeline at a time, in order, and clears when drained', async () => {
		await seed('a', 'pa');
		await seed('b', 'pb');
		processQueue.enqueue('a', 'pa');
		await flush();
		processQueue.enqueue('b', 'pb');
		await flush();

		expect(processQueue.pending).toBe(2);
		expect(processQueue.active).toBe(true);
		// 'b' must not start until 'a' finishes — never concurrent
		expect(h.calls).toEqual(['start:a']);

		h.resolvers.shift()!();
		await flush();
		expect(h.calls).toEqual(['start:a', 'end:a', 'start:b']);

		h.resolvers.shift()!();
		await flush();
		expect(h.calls).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
		expect(processQueue.pending).toBe(0);
		expect(processQueue.active).toBe(false);
	});

	it('re-enqueueing the same photo does not duplicate the job', async () => {
		await seed('a', 'pa');
		processQueue.enqueue('a', 'pa');
		processQueue.enqueue('a', 'pa');
		await flush();

		expect(await db.mlJobs.count()).toBe(1);
	});

	// The original failure mode: the queue was an in-memory array, so closing the
	// tab (or scanning offline before the models had ever downloaded) lost the OCR
	// name and the embedding permanently, with no retry.
	it('survives a session ending mid-queue', async () => {
		// A tab that dies mid-pipeline leaves its row behind as 'running'. The
		// in-process queue can't be killed, so the dead session is reproduced by
		// the state it leaves in Dexie.
		await seed('a', 'pa');
		await db.mlJobs.put({
			id: 'pa',
			itemId: 'a',
			remaining: ['barcode', 'ocr', 'embedding'],
			status: 'running',
			attempts: 0,
			nextAttemptAt: '2026-01-01T00:00:00.000Z',
			lastError: null,
			createdAt: '2026-01-01T00:00:00.000Z'
		});

		await processQueue.start();
		await flush();

		expect(h.calls).toEqual(['start:a']);
	});

	it('retries only the stages that failed', async () => {
		// ocrStage APPENDS to item.ocrText, so re-running a successful OCR to retry
		// the embedding would duplicate the recognized text on every attempt
		await seed('a', 'pa');
		processQueue.enqueue('a', 'pa');
		await flush();

		h.resolvers.shift()!(['embedding']);
		await flush();

		const job = (await db.mlJobs.get('pa'))!;
		expect(job.remaining).toEqual<MlStage[]>(['embedding']);
		expect(job.attempts).toBe(1);
		expect(job.status).toBe('pending');
		expect(job.lastError).toBe('boom');

		// due time has passed → the retry runs the failed stage alone
		await db.mlJobs.update('pa', { nextAttemptAt: '2026-01-01T00:00:00.000Z' });
		// not awaited: drain() only settles once the pipeline does, and this test
		// is the one that resolves it
		void processQueue.drain();
		await flush();

		expect(h.stagesSeen).toEqual([
			['barcode', 'ocr', 'embedding'],
			['embedding']
		]);
	});

	it('deletes the job once every stage has succeeded', async () => {
		await seed('a', 'pa');
		processQueue.enqueue('a', 'pa');
		await flush();

		h.resolvers.shift()!();
		await flush();

		expect(await db.mlJobs.count()).toBe(0);
	});

	it('backs off, then gives up and offers a retry', async () => {
		await seed('a', 'pa');
		processQueue.enqueue('a', 'pa');
		await flush();

		for (let attempt = 1; attempt <= 5; attempt++) {
			h.resolvers.shift()!(['ocr']);
			await flush();
			const job = await db.mlJobs.get('pa');
			if (attempt < 5) {
				expect(job!.attempts).toBe(attempt);
				await db.mlJobs.update('pa', { nextAttemptAt: '2026-01-01T00:00:00.000Z' });
				void processQueue.drain();
				await flush();
			}
		}

		expect((await db.mlJobs.get('pa'))!.status).toBe('failed');
		expect(processQueue.failed).toBe(1);
		expect(processQueue.pending).toBe(0);

		await processQueue.retryFailed();
		await flush();
		expect((await db.mlJobs.get('pa'))!.attempts).toBe(0);
		expect(h.calls.filter((c) => c === 'start:a')).toHaveLength(6);
	});

	it('waits out the backoff instead of hot-looping', async () => {
		await seed('a', 'pa');
		processQueue.enqueue('a', 'pa');
		await flush();
		h.resolvers.shift()!(['ocr']);
		await flush();

		await processQueue.drain();
		await flush();

		// still only the original run — the retry isn't due yet
		expect(h.calls.filter((c) => c === 'start:a')).toHaveLength(1);
	});

	it('drops a job whose item was deleted while it waited', async () => {
		await seed('a', 'pa');
		await db.items.update('a', { deletedAt: '2026-01-02T00:00:00.000Z' });
		processQueue.enqueue('a', 'pa');
		await flush();

		expect(h.calls).toEqual([]);
		expect(await db.mlJobs.count()).toBe(0);
	});

	it('drops a job whose photo is gone', async () => {
		await seed('a', 'pa');
		await db.photos.delete('pa');
		processQueue.enqueue('a', 'pa');
		await flush();

		expect(h.calls).toEqual([]);
		expect(await db.mlJobs.count()).toBe(0);
	});
});
