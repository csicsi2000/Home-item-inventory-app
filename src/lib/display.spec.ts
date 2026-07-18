import { describe, it, expect } from 'vitest';
import { collectionDisplay, itemChips, labelOptions } from './display';
import type { Collection, Item } from './db/types';

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
	it('falls back to grid + tags when nothing is configured', () => {
		expect(collectionDisplay(collection)).toEqual({ view: 'grid', labels: ['tags'] });
		expect(collectionDisplay(undefined)).toEqual({ view: 'grid', labels: ['tags'] });
	});

	it('returns the stored settings when present', () => {
		const c = { ...collection, display: { view: 'list' as const, labels: ['price'] } };
		expect(collectionDisplay(c)).toEqual({ view: 'list', labels: ['price'] });
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
