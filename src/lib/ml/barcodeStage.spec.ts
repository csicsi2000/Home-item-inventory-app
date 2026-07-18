import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('$app/paths', () => ({ base: '' }));
vi.mock('svelte-sonner', () => ({
	toast: { success: vi.fn(), info: vi.fn(), error: vi.fn(), loading: vi.fn() }
}));

const h = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('$lib/scan/lookup', () => ({ lookupBarcode: h.lookup }));

import { db } from '$lib/db/schema';
import { createCollection, createItem } from '$lib/db/repo';
import { settings } from '$lib/state/settings.svelte';
import { barcodeStage } from './barcodeStage';

let collectionId: string;

beforeEach(async () => {
	await Promise.all(db.tables.map((t) => t.clear()));
	h.lookup.mockReset();
	settings.onlineBarcodeLookup = true;
	const c = await createCollection({ name: 'Cards' });
	collectionId = c.id;
});

afterEach(() => {
	settings.onlineBarcodeLookup = false;
});

describe('barcodeStage', () => {
	it('does nothing when online lookup is disabled', async () => {
		settings.onlineBarcodeLookup = false;
		const item = await createItem({ collectionId, barcode: '123' });

		await barcodeStage(item.id);

		expect(h.lookup).not.toHaveBeenCalled();
		expect((await db.items.get(item.id))!.name).toBe('');
	});

	it('names an unnamed item from a barcode hit and fills the description', async () => {
		h.lookup.mockResolvedValue({ name: 'Cola', description: 'CocaCola — Soda' });
		const item = await createItem({ collectionId, barcode: '737628064502' });

		await barcodeStage(item.id);

		const updated = (await db.items.get(item.id))!;
		expect(h.lookup).toHaveBeenCalledWith('737628064502');
		expect(updated.name).toBe('Cola');
		expect(updated.description).toBe('CocaCola — Soda');
	});

	it('never overwrites a name the item already has', async () => {
		h.lookup.mockResolvedValue({ name: 'Cola' });
		const item = await createItem({ collectionId, barcode: '123', name: 'My Card' });

		await barcodeStage(item.id);

		expect(h.lookup).not.toHaveBeenCalled();
		expect((await db.items.get(item.id))!.name).toBe('My Card');
	});

	it('skips items without a barcode', async () => {
		const item = await createItem({ collectionId });

		await barcodeStage(item.id);

		expect(h.lookup).not.toHaveBeenCalled();
	});

	it('leaves the item unchanged when the lookup misses', async () => {
		h.lookup.mockResolvedValue(null);
		const item = await createItem({ collectionId, barcode: '999' });

		await barcodeStage(item.id);

		expect(h.lookup).toHaveBeenCalledOnce();
		expect((await db.items.get(item.id))!.name).toBe('');
	});
});
