import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isQuotaError, withQuotaGuard, storage } from './quota.svelte';

vi.mock('svelte-sonner', () => ({
	toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn() }
}));

beforeEach(() => {
	storage.full = false;
	vi.clearAllMocks();
});

describe('isQuotaError', () => {
	it('recognizes the DOMException browsers actually throw', () => {
		expect(isQuotaError(new DOMException('no room', 'QuotaExceededError'))).toBe(true);
	});

	it('recognizes the Dexie-wrapped form', () => {
		expect(isQuotaError({ name: 'QuotaExceededError', message: 'wrapped' })).toBe(true);
		expect(isQuotaError({ name: 'DexieError', message: 'QuotaExceededError: no room' })).toBe(true);
	});

	it('does not swallow unrelated errors', () => {
		expect(isQuotaError(new Error('network down'))).toBe(false);
		expect(isQuotaError(null)).toBe(false);
	});
});

describe('withQuotaGuard', () => {
	it('passes the value through on success', async () => {
		await expect(withQuotaGuard(async () => 42)).resolves.toBe(42);
		expect(storage.full).toBe(false);
	});

	it('returns null and flags storage as full when space runs out', async () => {
		const result = await withQuotaGuard(async () => {
			throw new DOMException('no room', 'QuotaExceededError');
		});

		expect(result).toBeNull();
		expect(storage.full).toBe(true);
	});

	it('warns the user once, not on every subsequent write', async () => {
		const { toast } = await import('svelte-sonner');
		const boom = () => Promise.reject(new DOMException('no room', 'QuotaExceededError'));

		await withQuotaGuard(boom);
		await withQuotaGuard(boom);

		expect(toast.error).toHaveBeenCalledTimes(1);
	});

	it('rethrows anything that is not a quota problem', async () => {
		await expect(
			withQuotaGuard(async () => {
				throw new Error('database closed');
			})
		).rejects.toThrow('database closed');
		expect(storage.full).toBe(false);
	});

	it('clears the full flag once a write succeeds again', async () => {
		await withQuotaGuard(() => Promise.reject(new DOMException('x', 'QuotaExceededError')));
		expect(storage.full).toBe(true);

		await withQuotaGuard(async () => 'ok');

		expect(storage.full).toBe(false);
	});
});
