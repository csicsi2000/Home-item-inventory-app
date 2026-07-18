import type { UUID } from '$lib/db/types';
import { runPostSavePipeline } from './pipeline';

interface Job {
	itemId: UUID;
	photoId: UUID;
}

/**
 * Serial background queue for post-save recognition (OCR, embeddings, barcode
 * lookup). The capture path used to fire `runPostSavePipeline` per photo with
 * no coordination, so rapid scanning spun up several Tesseract/TFJS instances
 * at once — hundreds of MB of wasm — and phones ran out of memory and crashed.
 *
 * Enqueueing here guarantees exactly one pipeline runs at a time, fully
 * decoupled from the shutter. `pending`/`active` are reactive so the UI can
 * show that background work is happening.
 */
class ProcessQueue {
	/** Items still waiting or currently being processed. */
	pending = $state(0);
	/** True while a pipeline is running. */
	active = $state(false);

	#jobs: Job[] = [];
	#running = false;

	enqueue(itemId: UUID, photoId: UUID): void {
		this.#jobs.push({ itemId, photoId });
		this.pending = this.#jobs.length + (this.#running ? 1 : 0);
		void this.#drain();
	}

	async #drain(): Promise<void> {
		if (this.#running) return;
		this.#running = true;
		this.active = true;
		try {
			while (this.#jobs.length) {
				const job = this.#jobs.shift()!;
				this.pending = this.#jobs.length + 1;
				try {
					await runPostSavePipeline(job.itemId, job.photoId);
				} catch (err) {
					console.warn('post-save pipeline failed', err);
				}
			}
		} finally {
			this.#running = false;
			this.active = false;
			this.pending = 0;
		}
	}
}

export const processQueue = new ProcessQueue();
