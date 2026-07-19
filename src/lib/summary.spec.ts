import { describe, it, expect } from 'vitest';
import { countByStatus, recentItems, summarizeItems, topValuableItems } from './summary';
import type { Item } from './db/types';

const mk = (extra: Partial<Item>): Item => ({
	id: crypto.randomUUID(),
	collectionId: 'c1',
	name: 'x',
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
	createdAt: '2026-01-01',
	updatedAt: '2026-01-01',
	deletedAt: null,
	dirty: 0,
	...extra
});

describe('summarizeItems', () => {
	it('counts items and pieces (quantity)', () => {
		const s = summarizeItems([mk({ quantity: 3 }), mk({ quantity: 2 })], 'USD');
		expect(s.items).toBe(2);
		expect(s.pieces).toBe(5);
	});

	it('multiplies acquisition value by quantity', () => {
		const s = summarizeItems([mk({ acquisitionPrice: 10, quantity: 3, currency: 'USD' })], 'USD');
		expect(s.value).toEqual([{ currency: 'USD', total: 30 }]);
	});

	it('groups value by currency and uses the default when unset', () => {
		const s = summarizeItems(
			[mk({ acquisitionPrice: 5, currency: 'EUR' }), mk({ acquisitionPrice: 20 })],
			'USD'
		);
		expect(s.value).toEqual([
			{ currency: 'USD', total: 20 },
			{ currency: 'EUR', total: 5 }
		]);
	});

	it('tracks sold proceeds separately', () => {
		const s = summarizeItems(
			[mk({ status: 'sold', soldPrice: 25, acquisitionPrice: 10, currency: 'USD' })],
			'USD'
		);
		expect(s.sold).toEqual([{ currency: 'USD', total: 25 }]);
		expect(s.value).toEqual([{ currency: 'USD', total: 10 }]);
	});

	it('is empty for no items', () => {
		expect(summarizeItems([], 'USD')).toEqual({ items: 0, pieces: 0, value: [], sold: [] });
	});
});

describe('topValuableItems', () => {
	it('ranks by price × quantity and excludes items without a price', () => {
		const a = mk({ name: 'a', acquisitionPrice: 100, quantity: 1 });
		const b = mk({ name: 'b', acquisitionPrice: 30, quantity: 5 }); // 150
		const c = mk({ name: 'c', acquisitionPrice: null, quantity: 9 });
		const top = topValuableItems([a, b, c]);
		expect(top.map((i) => i.name)).toEqual(['b', 'a']);
	});

	it('caps to n', () => {
		const items = Array.from({ length: 10 }, (_, i) => mk({ acquisitionPrice: i + 1 }));
		expect(topValuableItems(items, 3)).toHaveLength(3);
	});
});

describe('recentItems', () => {
	it('returns newest first, capped to n', () => {
		const a = mk({ name: 'a', createdAt: '2026-01-01' });
		const b = mk({ name: 'b', createdAt: '2026-03-01' });
		const c = mk({ name: 'c', createdAt: '2026-02-01' });
		expect(recentItems([a, b, c], 2).map((i) => i.name)).toEqual(['b', 'c']);
	});
});

describe('countByStatus', () => {
	it('tallies each status', () => {
		const items = [mk({ status: 'owned' }), mk({ status: 'sold' }), mk({ status: 'owned' })];
		expect(countByStatus(items)).toEqual({ owned: 2, sold: 1, wishlist: 0 });
	});
});
