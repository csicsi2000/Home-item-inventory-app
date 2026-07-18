import { describe, it, expect, vi } from 'vitest';

// Shared recorder the mocked pipeline writes to. vi.hoisted so the vi.mock
// factory (hoisted above imports) can safely close over it.
const h = vi.hoisted(() => ({ calls: [] as string[], resolvers: [] as Array<() => void> }));

vi.mock('./pipeline', () => ({
	runPostSavePipeline: (itemId: string) => {
		h.calls.push(`start:${itemId}`);
		return new Promise<void>((resolve) => {
			h.resolvers.push(() => {
				h.calls.push(`end:${itemId}`);
				resolve();
			});
		});
	}
}));

import { processQueue } from './queue.svelte';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('processQueue', () => {
	it('runs one pipeline at a time, in FIFO order, and clears when drained', async () => {
		processQueue.enqueue('a', 'pa');
		processQueue.enqueue('b', 'pb');

		// both jobs counted; the queue is active but only the first has started
		expect(processQueue.pending).toBe(2);
		expect(processQueue.active).toBe(true);
		await flush();
		expect(h.calls).toEqual(['start:a']);

		// 'b' must not start until 'a' finishes — never concurrent
		h.resolvers.shift()!();
		await flush();
		expect(h.calls).toEqual(['start:a', 'end:a', 'start:b']);

		// finishing the last job empties the queue and goes idle
		h.resolvers.shift()!();
		await flush();
		expect(h.calls).toEqual(['start:a', 'end:a', 'start:b', 'end:b']);
		expect(processQueue.pending).toBe(0);
		expect(processQueue.active).toBe(false);
	});
});
