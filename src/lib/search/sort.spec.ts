import { describe, it, expect } from 'vitest';
import { sortHits } from './sort';
import type { SearchHit } from './index';
import type { Item } from '$lib/db/types';

const makeItem = (over: Partial<Item>): Item => ({
	id: 'i1',
	collectionId: 'c1',
	name: 'Item',
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
	createdAt: '2026-01-01T00:00:00Z',
	updatedAt: '2026-01-01T00:00:00Z',
	deletedAt: null,
	dirty: 0,
	...over
});

const hit = (over: Partial<Item>, score: number): SearchHit => ({ item: makeItem(over), score });

describe('sortHits', () => {
	const hits = [
		hit({ id: 'a', name: 'Zeta', acquisitionPrice: 10, createdAt: '2026-01-01T00:00:00Z' }, 1),
		hit({ id: 'b', name: 'alpha', acquisitionPrice: null, createdAt: '2026-03-01T00:00:00Z' }, 5),
		hit({ id: 'c', name: 'Mu', acquisitionPrice: 50, createdAt: '2026-02-01T00:00:00Z' }, 3)
	];

	it('keeps relevance (score) order and returns a copy', () => {
		const out = sortHits(hits, 'relevance');
		expect(out).not.toBe(hits);
		expect(out.map((h) => h.item.id)).toEqual(['a', 'b', 'c']);
	});

	it('sorts by name case-insensitively', () => {
		expect(sortHits(hits, 'name').map((h) => h.item.id)).toEqual(['b', 'c', 'a']);
	});

	it('sorts by newest first', () => {
		expect(sortHits(hits, 'newest').map((h) => h.item.id)).toEqual(['b', 'c', 'a']);
	});

	it('sorts by price high-to-low with nulls last', () => {
		expect(sortHits(hits, 'price').map((h) => h.item.id)).toEqual(['c', 'a', 'b']);
	});
});
