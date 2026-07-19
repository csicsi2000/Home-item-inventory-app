/** CSV export for collections — opens cleanly in Excel / Google Sheets. */

import type { Collection, Item } from '$lib/db/types';
import { ancestorsOf } from '$lib/tree';

/** Quote a value if it contains a delimiter, quote, or newline; double inner quotes. */
export function csvEscape(value: string): string {
	return /[",;\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const FIXED_COLUMNS = [
	'collection',
	'name',
	'description',
	'quantity',
	'status',
	'condition',
	'tags',
	'barcode',
	'acquisition_price',
	'acquisition_date',
	'sold_price',
	'sold_date',
	'currency',
	'created_at'
] as const;

const num = (n: number | null): string => (n === null ? '' : String(n));

/** Full "A / B / C" path of a collection using the folder tree. */
function collectionPath(collection: Collection | undefined, collections: Collection[]): string {
	if (!collection) return '';
	return [...ancestorsOf(collections, collection.id), collection]
		.map((c) => c.name)
		.join(' / ');
}

/**
 * Serialize items to CSV (RFC 4180: CRLF rows, quoted fields). A UTF-8 BOM is
 * prepended so Excel reads accented characters correctly. Custom fields become
 * `cf_<label>` columns — the union of every label seen across the exported
 * collections and the items themselves, so nothing is silently dropped.
 */
export function itemsToCsv(items: Item[], collections: Collection[]): string {
	const byId = new Map(collections.map((c) => [c.id, c]));

	// union of custom-field labels: collection templates + any orphaned keys on items
	const customLabels = new Set<string>();
	for (const c of collections) for (const f of c.fields) customLabels.add(f.label);
	for (const item of items) for (const label of Object.keys(item.customFields)) customLabels.add(label);
	const customCols = [...customLabels].sort((a, b) => a.localeCompare(b));

	const header = [...FIXED_COLUMNS, ...customCols.map((l) => `cf_${l}`)];

	const rows = items.map((item) => {
		const fixed = [
			collectionPath(byId.get(item.collectionId), collections),
			item.name,
			item.description ?? '',
			String(item.quantity),
			item.status,
			item.condition ?? '',
			item.tags.join('; '),
			item.barcode ?? '',
			num(item.acquisitionPrice),
			item.acquisitionDate ?? '',
			num(item.soldPrice),
			item.soldDate ?? '',
			item.currency ?? '',
			item.createdAt
		];
		const custom = customCols.map((label) => item.customFields[label] ?? '');
		return [...fixed, ...custom].map((v) => csvEscape(v)).join(',');
	});

	return '﻿' + [header.join(','), ...rows].join('\r\n');
}
