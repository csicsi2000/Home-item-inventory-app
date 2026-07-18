import { describe, it, expect } from 'vitest';
import { summarizeItems } from './summary';
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
