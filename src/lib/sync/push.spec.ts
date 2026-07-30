import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/schema';
import { createCollection, updateItem } from '$lib/db/repo';
import type { RemoteRow } from './mapping';
import { push, pull, type FetchPage, type UpsertRows } from './engine.svelte';
import {
	MAX_ATTEMPTS,
	TransientSyncError,
	backoffMs,
	classifyPushError,
	failureKey
} from './failures';

vi.mock('./supabase', () => ({ supabase: null, syncConfigured: false }));

beforeEach(async () => {
	await Promise.all(db.tables.map((t) => t.clear()));
});

afterEach(() => {
	vi.useRealTimers();
});

/** Rejects specific item ids; records every request. */
function fakeServer(reject: (row: RemoteRow) => { code: string; message: string } | null) {
	const batches: { table: string; ids: string[] }[] = [];
	const upsert: UpsertRows = async (table, rows) => {
		batches.push({ table, ids: rows.map((r) => String(r.id)) });
		for (const row of rows) {
			const error = reject(row);
			if (error) return error;
		}
		return null;
	};
	return { upsert, batches, calls: () => batches.length };
}

/**
 * Only Date is faked. Faking setTimeout as well deadlocks Dexie and
 * fake-indexeddb, which need real timers to settle their transactions.
 */
const advanceClock = (ms: number) => {
	if (!vi.isFakeTimers()) vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date(Date.now() + ms));
};

const seedItems = async (count: number) => {
	const collection = await createCollection({ name: 'Cards' });
	await db.collections.update(collection.id, { dirty: 0 });
	const t = new Date().toISOString();
	const items = Array.from({ length: count }, (_, i) => ({
		id: `item-${String(i).padStart(4, '0')}`,
		collectionId: collection.id,
		name: `Item ${String(i).padStart(4, '0')}`,
		description: null,
		quantity: 1,
		status: 'owned' as const,
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
		dirty: 1 as const
	}));
	await db.items.bulkPut(items);
	return items;
};

describe('classifyPushError', () => {
	it.each([
		['42501', 'new row violates row-level security policy', 'permanent'],
		['23505', 'duplicate key value violates unique constraint', 'permanent'],
		['22P02', 'invalid input syntax for type uuid', 'permanent'],
		['PGRST204', "Could not find the 'nickname' column of 'items'", 'schema'],
		['42703', 'column "nickname" does not exist', 'schema']
	])('classifies %s as %s', (code, message, kind) => {
		expect(classifyPushError({ code, message })).toBe(kind);
	});

	it('treats network and server errors as transient so nothing is quarantined', () => {
		expect(classifyPushError({ message: 'TypeError: fetch failed' })).toBe('transient');
		expect(classifyPushError({ message: 'gateway', status: 502 })).toBe('transient');
		expect(classifyPushError({ message: 'slow down', status: 429 })).toBe('transient');
	});

	it('grows the backoff and caps it at a day', () => {
		expect(backoffMs(1)).toBe(2 * 60_000);
		expect(backoffMs(3)).toBe(8 * 60_000);
		expect(backoffMs(99)).toBe(24 * 60 * 60_000);
	});
});

describe('push quarantine', () => {
	it('pushes every other row when the server refuses one', async () => {
		const items = await seedItems(20);
		const bad = items[7];
		const { upsert } = fakeServer((row) =>
			row.id === bad.id ? { code: '42501', message: 'row-level security' } : null
		);

		const pushed = await push(upsert);

		expect(pushed).toBe(19);
		expect((await db.items.get(bad.id))!.dirty).toBe(1);
		const others = await db.items.where('dirty').equals(1).toArray();
		expect(others.map((i) => i.id)).toEqual([bad.id]);
	});

	it('records the offending row with a future retry time', async () => {
		const items = await seedItems(4);
		const bad = items[1];
		const { upsert } = fakeServer((row) =>
			row.id === bad.id ? { code: '42501', message: 'row-level security' } : null
		);

		await push(upsert);

		const failure = (await db.syncFailures.get(failureKey('items', bad.id)))!;
		expect(failure.attempts).toBe(1);
		expect(failure.code).toBe('42501');
		expect(failure.failedUpdatedAt).toBe(bad.updatedAt);
		expect(failure.nextAttemptAt > new Date().toISOString()).toBe(true);
	});

	it('does not retry a quarantined row on the next push', async () => {
		const items = await seedItems(3);
		const bad = items[0];
		const { upsert, batches } = fakeServer((row) =>
			row.id === bad.id ? { code: '42501', message: 'row-level security' } : null
		);
		await push(upsert);
		batches.length = 0;

		const pushed = await push(upsert);

		expect(pushed).toBe(0);
		expect(batches).toHaveLength(0);
	});

	it('narrows a big chunk to the culprit in logarithmically many requests', async () => {
		const items = await seedItems(400);
		const bad = items[321];
		const { upsert, calls } = fakeServer((row) =>
			row.id === bad.id ? { code: '42501', message: 'row-level security' } : null
		);

		await push(upsert);

		// 1 failed full chunk + at most 2 requests per halving level
		expect(calls()).toBeLessThanOrEqual(2 * Math.ceil(Math.log2(400)) + 2);
		expect(await db.items.where('dirty').equals(1).count()).toBe(1);
	});

	it('retries once the backoff has elapsed', async () => {
		const items = await seedItems(2);
		const bad = items[0];
		let refuse = true;
		const { upsert } = fakeServer((row) =>
			refuse && row.id === bad.id ? { code: '42501', message: 'row-level security' } : null
		);
		await push(upsert);

		refuse = false;
		advanceClock(backoffMs(1) + 1000);

		const pushed = await push(upsert);

		expect(pushed).toBe(1);
		expect((await db.items.get(bad.id))!.dirty).toBe(0);
		expect(await db.syncFailures.count()).toBe(0);
	});

	it('stops retrying on a timer once it has given up', async () => {
		const items = await seedItems(1);
		const bad = items[0];
		const { upsert } = fakeServer(() => ({ code: '42501', message: 'row-level security' }));
		for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
			await push(upsert);
			advanceClock(backoffMs(attempt) + 1000);
		}

		const failure = (await db.syncFailures.get(failureKey('items', bad.id)))!;

		expect(failure.attempts).toBe(MAX_ATTEMPTS);
		expect(failure.nextAttemptAt).toBe('9999-12-31T00:00:00.000Z');
	});

	it('retries immediately after the user edits a quarantined row', async () => {
		const items = await seedItems(1);
		const bad = items[0];
		let refuse = true;
		const { upsert } = fakeServer(() =>
			refuse ? { code: '42501', message: 'row-level security' } : null
		);
		await push(upsert);
		expect(await db.syncFailures.count()).toBe(1);

		refuse = false;
		await updateItem(bad.id, { name: 'Fixed' });
		const pushed = await push(upsert);

		expect(pushed).toBe(1);
		expect(await db.syncFailures.count()).toBe(0);
	});

	it('rethrows a transient error and quarantines nothing', async () => {
		await seedItems(3);
		const { upsert } = fakeServer(() => ({ code: '', message: 'TypeError: fetch failed' }));

		await expect(push(upsert)).rejects.toThrow(TransientSyncError);
		expect(await db.syncFailures.count()).toBe(0);
		expect(await db.items.where('dirty').equals(1).count()).toBe(3);
	});

	it('quarantines a whole table in one request when a column is missing', async () => {
		await seedItems(50);
		const { upsert, calls } = fakeServer(() => ({
			code: 'PGRST204',
			message: "Could not find the 'nickname' column of 'items'"
		}));

		await push(upsert);

		// no bisection: every row would fail identically
		expect(calls()).toBe(1);
		expect(await db.syncFailures.count()).toBe(0);
		expect(await db.meta.get('schema-block:items')).toBeDefined();
	});

	it('skips a schema-blocked table until the block expires', async () => {
		await seedItems(2);
		const { upsert, batches } = fakeServer(() => ({
			code: 'PGRST204',
			message: "Could not find the 'nickname' column of 'items'"
		}));
		await push(upsert);
		batches.length = 0;

		await push(upsert);
		expect(batches).toHaveLength(0);

		advanceClock(11 * 60_000);
		const { upsert: fixed, batches: retried } = fakeServer(() => null);
		const pushed = await push(fixed);

		expect(retried).toHaveLength(1);
		expect(pushed).toBe(2);
	});
});

describe('a permanently rejected row no longer wedges the whole sync', () => {
	// The original failure mode: push() threw on the first bad row, so syncNow
	// aborted before pull(). The device stopped receiving data too — forever.
	it('still pulls after a permanent push failure', async () => {
		const items = await seedItems(2);
		const { upsert } = fakeServer((row) =>
			row.id === items[0].id ? { code: '42501', message: 'row-level security' } : null
		);
		const remote: RemoteRow = {
			id: 'from-another-device',
			collection_id: 'col-1',
			name: 'Arrived anyway',
			created_at: '2026-01-01T00:00:00.000Z',
			updated_at: '2026-01-01T00:00:00.000Z',
			deleted_at: null,
			server_updated_at: 'ts-1'
		};
		let served = false;
		const fetchPage: FetchPage = async (table) => {
			if (table !== 'items' || served) return [];
			served = true;
			return [remote];
		};

		await push(upsert);
		await pull(fetchPage, 10);

		expect((await db.items.get('from-another-device'))!.name).toBe('Arrived anyway');
	});
});
