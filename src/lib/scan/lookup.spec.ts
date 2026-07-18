import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { lookupBarcode } from './lookup';

function jsonResponse(body: unknown, ok = true): Response {
	return { ok, json: async () => body } as Response;
}

beforeEach(() => {
	vi.stubGlobal('navigator', { onLine: true });
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('lookupBarcode', () => {
	it('returns null for an empty code without touching the network', async () => {
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		expect(await lookupBarcode('   ')).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('skips the network entirely when offline', async () => {
		vi.stubGlobal('navigator', { onLine: false });
		const fetchMock = vi.fn();
		vi.stubGlobal('fetch', fetchMock);
		expect(await lookupBarcode('12345')).toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('maps an Open Food Facts hit to name + brand', async () => {
		const fetchMock = vi.fn(async () =>
			jsonResponse({
				status: 1,
				product: { product_name: 'Cola', brands: 'CocaCola, Coke', generic_name: 'Soda' }
			})
		);
		vi.stubGlobal('fetch', fetchMock);

		const info = await lookupBarcode('737628064502');
		expect(info?.name).toBe('Cola');
		expect(info?.brand).toBe('CocaCola');
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it('falls through to UPCitemdb when Open Food Facts misses', async () => {
		const fetchMock = vi.fn(async (url: string | URL) => {
			if (String(url).includes('openfoodfacts')) return jsonResponse({ status: 0 });
			return jsonResponse({ items: [{ title: 'RAM Stick 16GB', brand: 'Kingston', description: 'DDR4' }] });
		});
		vi.stubGlobal('fetch', fetchMock);

		const info = await lookupBarcode('0740617290677');
		expect(info?.name).toBe('RAM Stick 16GB');
		expect(info?.brand).toBe('Kingston');
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});

	it('returns null when every source misses', async () => {
		const fetchMock = vi.fn(async (url: string | URL) => {
			if (String(url).includes('openfoodfacts')) return jsonResponse({ status: 0 });
			return jsonResponse({ items: [] });
		});
		vi.stubGlobal('fetch', fetchMock);
		expect(await lookupBarcode('000000000000')).toBeNull();
	});

	it('treats a non-ok HTTP response as a miss', async () => {
		const fetchMock = vi.fn(async () => jsonResponse({}, false));
		vi.stubGlobal('fetch', fetchMock);
		expect(await lookupBarcode('123')).toBeNull();
	});

	it('never throws when fetch rejects', async () => {
		const fetchMock = vi.fn(async () => {
			throw new Error('network down');
		});
		vi.stubGlobal('fetch', fetchMock);
		expect(await lookupBarcode('123')).toBeNull();
	});
});
