import { db } from '$lib/db/schema';
import type { MlJob, MlStage, UUID } from '$lib/db/types';
import { ALL_STAGES, runPostSavePipeline } from './pipeline';

/**
 * Durable, serial background queue for post-save recognition (OCR, embeddings,
 * barcode lookup).
 *
 * Two problems it solves:
 *
 *  1. The capture path used to fire `runPostSavePipeline` per photo with no
 *     coordination, so rapid scanning spun up several Tesseract/TFJS instances at
 *     once — hundreds of MB of wasm — and phones ran out of memory and crashed.
 *     Exactly one pipeline runs at a time, fully decoupled from the shutter.
 *  2. The queue used to be an in-memory array. Closing the tab, or scanning while
 *     offline before the models had ever downloaded, lost the OCR name and the
 *     embedding permanently — with no retry and nothing but a console warning.
 *     Jobs now live in Dexie and resume on the next launch.
 */

/** 15s, 1m, 5m, 30m, 2h. */
const BACKOFF_MS = [15_000, 60_000, 300_000, 1_800_000, 7_200_000];
const MAX_ATTEMPTS = BACKOFF_MS.length;
/** Drop given-up jobs this old, so a permanently broken photo doesn't linger. */
const FAILED_TTL_MS = 7 * 86_400_000;

const nowIso = () => new Date().toISOString();

class ProcessQueue {
	/** Jobs waiting or in flight. */
	pending = $state(0);
	/** True while a pipeline is running. */
	active = $state(false);
	/** Jobs that exhausted their retries — surfaced so the user can retry. */
	failed = $state(0);

	#running = false;
	#drainAgain = false;

	/**
	 * Fire-and-forget from the capture path. Keyed by photoId, so re-enqueueing the
	 * same photo replaces rather than duplicates.
	 */
	enqueue(itemId: UUID, photoId: UUID): void {
		void this.#enqueue(itemId, photoId);
	}

	async #enqueue(itemId: UUID, photoId: UUID): Promise<void> {
		try {
			const existing = await db.mlJobs.get(photoId);
			await db.mlJobs.put({
				id: photoId,
				itemId,
				// keep whatever is left if the job is already part-way through
				remaining: existing?.remaining.length ? existing.remaining : [...ALL_STAGES],
				status: 'pending',
				attempts: 0,
				nextAttemptAt: nowIso(),
				lastError: null,
				createdAt: existing?.createdAt ?? nowIso()
			});
			await this.refresh();
			void this.drain();
		} catch (err) {
			console.warn('could not queue recognition job', err);
		}
	}

	/**
	 * Pick up where a previous session left off. Called once at app start; also
	 * safe to call on `online` / `visibilitychange`.
	 */
	async start(): Promise<void> {
		try {
			// a job left 'running' means the tab died mid-pipeline
			await db.mlJobs.where('status').equals('running').modify({ status: 'pending' });
			await this.#dropStaleJobs();
			await this.refresh();
		} catch (err) {
			console.warn('could not restore the recognition queue', err);
		}
		void this.drain();
	}

	async refresh(): Promise<void> {
		this.pending = await db.mlJobs.where('status').notEqual('failed').count();
		this.failed = await db.mlJobs.where('status').equals('failed').count();
	}

	/** Put every given-up job back in line. */
	async retryFailed(): Promise<void> {
		await db.mlJobs
			.where('status')
			.equals('failed')
			.modify({ status: 'pending', attempts: 0, nextAttemptAt: nowIso() });
		await this.refresh();
		void this.drain();
	}

	async drain(): Promise<void> {
		// Two tabs draining at once reintroduces exactly the concurrent-Tesseract
		// OOM this queue exists to prevent.
		const locks = navigator.locks;
		if (locks?.request) {
			await locks.request('ml-queue', { ifAvailable: true }, async (lock) => {
				if (lock) await this.#drain();
			});
			return;
		}
		await this.#drain();
	}

	async #drain(): Promise<void> {
		if (this.#running) {
			this.#drainAgain = true;
			return;
		}
		this.#running = true;
		this.active = true;
		try {
			do {
				this.#drainAgain = false;
				for (;;) {
					const job = await this.#claimNext();
					if (!job) break;
					await this.#run(job);
					await this.refresh();
				}
			} while (this.#drainAgain);
		} finally {
			this.#running = false;
			this.active = false;
			await this.refresh().catch(() => {});
		}
	}

	/** The earliest due job, flipped to 'running' so nothing else takes it. */
	async #claimNext(): Promise<MlJob | undefined> {
		const now = nowIso();
		const due = await db.mlJobs
			.where('status')
			.equals('pending')
			.filter((j) => j.nextAttemptAt <= now)
			.sortBy('createdAt');
		const job = due[0];
		if (!job) return undefined;
		await db.mlJobs.update(job.id, { status: 'running' });
		return job;
	}

	async #run(job: MlJob): Promise<void> {
		// the item or photo may have been deleted while the job sat in the queue
		const [item, photo] = await Promise.all([db.items.get(job.itemId), db.photos.get(job.id)]);
		if (!item || item.deletedAt || !photo || photo.deletedAt) {
			await db.mlJobs.delete(job.id);
			return;
		}

		const stages: MlStage[] = job.remaining.length ? job.remaining : [...ALL_STAGES];
		let result;
		try {
			result = await runPostSavePipeline(job.itemId, job.id, stages);
		} catch (err) {
			// runPostSavePipeline isolates stage errors, so reaching here means the
			// pipeline module itself failed to load
			result = { completed: [], failed: stages.map((stage) => ({ stage, error: err })) };
		}

		if (!result.failed.length) {
			await db.mlJobs.delete(job.id);
			return;
		}

		const attempts = job.attempts + 1;
		const [{ error }] = result.failed;
		await db.mlJobs.update(job.id, {
			// retry only what didn't finish: ocrStage APPENDS to item.ocrText, so
			// re-running an already-successful OCR would duplicate the text
			remaining: result.failed.map((f) => f.stage),
			attempts,
			status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
			nextAttemptAt: new Date(
				Date.now() + BACKOFF_MS[Math.min(attempts, MAX_ATTEMPTS) - 1]
			).toISOString(),
			lastError: error instanceof Error ? error.message : String(error)
		});
	}

	async #dropStaleJobs(): Promise<void> {
		const cutoff = new Date(Date.now() - FAILED_TTL_MS).toISOString();
		await db.mlJobs
			.where('status')
			.equals('failed')
			.filter((j) => j.createdAt < cutoff)
			.delete();
	}
}

export const processQueue = new ProcessQueue();
