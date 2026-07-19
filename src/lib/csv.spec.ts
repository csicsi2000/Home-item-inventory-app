import { describe, it, expect } from 'vitest';
import { csvEscape, itemsToCsv } from './csv';
import type { Collection, Item } from './db/types';

const makeCollection = (over: Partial<Collection>): Collection => ({
	id: 'c1',
	name: 'Cards',
	parentId: null,
	icon: null,
	description: null,
	fields: [],
	display: null,
	createdAt: '2026-01-01T00:00:00Z',
	updatedAt: '2026-01-01T00:00:00Z',
	deletedAt: null,
	dirty: 0,
	...over
});

const makeItem = (over: Partial<Item>): Item => ({
	id: 'i1',
	collectionId: 'c1',
	name: 'Charizard',
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
	createdAt: '2026-02-01T00:00:00Z',
	updatedAt: '2026-02-01T00:00:00Z',
	deletedAt: null,
	dirty: 0,
	...over
});

describe('csvEscape', () => {
	it('leaves plain values untouched', () => {
		expect(csvEscape('hello')).toBe('hello');
	});
	it('quotes and doubles quotes when a comma, quote, semicolon or newline is present', () => {
		expect(csvEscape('a,b')).toBe('"a,b"');
		expect(csvEscape('a;b')).toBe('"a;b"');
		expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
		expect(csvEscape('line1\nline2')).toBe('"line1\nline2"');
	});
});

describe('itemsToCsv', () => {
	it('starts with a UTF-8 BOM and CRLF rows', () => {
		const csv = itemsToCsv([makeItem({})], [makeCollection({})]);
		expect(csv.startsWith('﻿')).toBe(true);
		expect(csv).toContain('\r\n');
	});

	it('writes a header-only file for no items', () => {
		const csv = itemsToCsv([], [makeCollection({})]);
		const lines = csv.replace('﻿', '').split('\r\n');
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('collection');
		expect(lines[0]).toContain('name');
	});

	it('keeps every row the same cell count as the header', () => {
		const collections = [makeCollection({ fields: [{ id: 'f1', label: 'Grade', type: 'text' }] })];
		const items = [makeItem({ customFields: { Grade: '10' } }), makeItem({ id: 'i2', name: 'Blastoise' })];
		const lines = itemsToCsv(items, collections).replace('﻿', '').split('\r\n');
		const cols = lines[0].split(',').length;
		for (const line of lines.slice(1)) {
			// naive split is fine here — none of these fixtures contain quoted commas
			expect(line.split(',')).toHaveLength(cols);
		}
	});

	it('escapes commas and quotes in names and joins tags with semicolons', () => {
		const items = [makeItem({ name: 'Pikachu, VMAX', tags: ['rare', 'holo'] })];
		const csv = itemsToCsv(items, [makeCollection({})]);
		expect(csv).toContain('"Pikachu, VMAX"');
		expect(csv).toContain('rare; holo');
	});

	it('unions custom-field labels from templates and orphaned item keys', () => {
		const collections = [makeCollection({ fields: [{ id: 'f1', label: 'Grade', type: 'text' }] })];
		const items = [makeItem({ customFields: { Grade: '9', Set: 'Base' } })]; // "Set" not in template
		const csv = itemsToCsv(items, collections);
		const header = csv.replace('﻿', '').split('\r\n')[0];
		expect(header).toContain('cf_Grade');
		expect(header).toContain('cf_Set');
	});

	it('writes the full nested collection path', () => {
		const parent = makeCollection({ id: 'p', name: 'Pokemon' });
		const child = makeCollection({ id: 'c1', name: 'Base Set', parentId: 'p' });
		const csv = itemsToCsv([makeItem({ collectionId: 'c1' })], [parent, child]);
		expect(csv).toContain('Pokemon / Base Set');
	});
});
