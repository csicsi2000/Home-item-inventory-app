import { describe, it, expect } from 'vitest';
import { collectionDisplay, DEFAULT_SORT, itemChips, labelOptions, sortItems } from './display';
import type { Collection, CollectionSort, Item } from './db/types';

const collection: Collection = {
	id: 'c1',
	name: 'Cards',
	parentId: null,
	icon: null,
	description: null,
	fields: [{ id: 'f1', label: 'Card ID', type: 'text' }],
	display: null,
	createdAt: '2026-01-01T00:00:00Z',
	updatedAt: '2026-01-01T00:00:00Z',
	deletedAt: null,
	dirty: 0
};

const item: Item = {
	id: 'i1',
	collectionId: 'c1',
	name: 'Holo Charizard',
	description: null,
	quantity: 3,
	status: 'owned',
	condition: 'mint',
	tags: ['rare', 'holo'],
	barcode: null,
	ocrText: null,
	acquisitionPrice: 120,
	acquisitionDate: '2026-05-01',
	soldPrice: null,
	soldDate: null,
	currency: 'CHF',
	customFields: { 'Card ID': '4/102' },
	createdAt: '2026-01-01T00:00:00Z',
	updatedAt: '2026-01-01T00:00:00Z',
	deletedAt: null,
	dirty: 0
};

describe('collectionDisplay', () => {
	it('falls back to grid + tags + newest-first when nothing is configured', () => {
		expect(collectionDisplay(collection)).toEqual({
			view: 'grid',
			labels: ['tags'],
			sort: DEFAULT_SORT
		});
		expect(collectionDisplay(undefined)).toEqual({
			view: 'grid',
			labels: ['tags'],
			sort: DEFAULT_SORT
		});
	});

	it('fills the default sort for legacy display objects that lack it', () => {
		const c = { ...collection, display: { view: 'list' as const, labels: ['price'] } };
		expect(collectionDisplay(c)).toEqual({ view: 'list', labels: ['price'], sort: DEFAULT_SORT });
	});

	it('returns the stored sort when present', () => {
		const sort: CollectionSort = { key: 'name', dir: 'asc' };
		const c = { ...collection, display: { view: 'grid' as const, labels: ['tags'], sort } };
		expect(collectionDisplay(c).sort).toEqual(sort);
	});
});

describe('sortItems', () => {
	const make = (over: Partial<Item>): Item => ({ ...item, ...over });
	const a = make({ id: 'a', name: 'Alpha', quantity: 5, acquisitionPrice: 30, createdAt: '2026-01-01T00:00:00Z' });
	const b = make({ id: 'b', name: 'bravo', quantity: 1, acquisitionPrice: 10, createdAt: '2026-03-01T00:00:00Z' });
	const c = make({ id: 'c', name: 'Charlie', quantity: 9, acquisitionPrice: null, createdAt: '2026-02-01T00:00:00Z' });
	const items = [a, b, c];

	it('does not mutate the input array', () => {
		const copy = [...items];
		sortItems(items, { key: 'name', dir: 'asc' });
		expect(items).toEqual(copy);
	});

	it('sorts by name case-insensitively, both directions', () => {
		expect(sortItems(items, { key: 'name', dir: 'asc' }).map((i) => i.id)).toEqual(['a', 'b', 'c']);
		expect(sortItems(items, { key: 'name', dir: 'desc' }).map((i) => i.id)).toEqual(['c', 'b', 'a']);
	});

	it('sorts by quantity, both directions', () => {
		expect(sortItems(items, { key: 'quantity', dir: 'asc' }).map((i) => i.id)).toEqual(['b', 'a', 'c']);
		expect(sortItems(items, { key: 'quantity', dir: 'desc' }).map((i) => i.id)).toEqual(['c', 'a', 'b']);
	});

	it('sorts by date added, both directions', () => {
		expect(sortItems(items, { key: 'createdAt', dir: 'asc' }).map((i) => i.id)).toEqual(['a', 'c', 'b']);
		expect(sortItems(items, { key: 'createdAt', dir: 'desc' }).map((i) => i.id)).toEqual(['b', 'c', 'a']);
	});

	it('always sorts null prices last, in both directions', () => {
		expect(sortItems(items, { key: 'price', dir: 'asc' }).map((i) => i.id)).toEqual(['b', 'a', 'c']);
		expect(sortItems(items, { key: 'price', dir: 'desc' }).map((i) => i.id)).toEqual(['a', 'b', 'c']);
	});

	it('breaks ties by newest first', () => {
		const x = make({ id: 'x', name: 'Same', quantity: 2, createdAt: '2026-01-01T00:00:00Z' });
		const y = make({ id: 'y', name: 'Same', quantity: 2, createdAt: '2026-05-01T00:00:00Z' });
		expect(sortItems([x, y], { key: 'name', dir: 'asc' }).map((i) => i.id)).toEqual(['y', 'x']);
	});
});

describe('labelOptions', () => {
	it('includes built-ins plus the collection fields', () => {
		const keys = labelOptions(collection).map((o) => o.key);
		expect(keys).toContain('price');
		expect(keys).toContain('tags');
		expect(keys).toContain('cf:f1');
	});
});

describe('itemChips', () => {
	it('formats prices in the item currency', () => {
		const [chip] = itemChips(item, ['price'], collection, 'USD');
		expect(chip).toContain('120');
		expect(chip).toMatch(/CHF/);
	});

	it('resolves collection fields via the field id', () => {
		expect(itemChips(item, ['cf:f1'], collection, 'USD')).toEqual(['4/102']);
	});

	it('skips labels the item has no value for', () => {
		expect(itemChips(item, ['soldPrice'], collection, 'USD')).toEqual([]);
		const bare = { ...item, tags: [], condition: null };
		expect(itemChips(bare, ['tags', 'condition'], collection, 'USD')).toEqual([]);
	});

	it('renders quantity, status, tags and condition', () => {
		expect(itemChips(item, ['quantity', 'status', 'condition', 'tags'], collection, 'USD')).toEqual([
			'×3',
			'Owned',
			'mint',
			'#rare #holo'
		]);
	});
});
