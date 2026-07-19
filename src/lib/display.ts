/** Per-collection view settings + the short label chips shown on items. */

import type { Collection, CollectionDisplay, CollectionSort, Item, SortKey } from '$lib/db/types';
import { formatMoney } from '$lib/currency';

/** Sort applied before item sort settings existed: newest first. */
export const DEFAULT_SORT: CollectionSort = { key: 'createdAt', dir: 'desc' };

/** Matches the app's look before display settings existed. */
export const DEFAULT_DISPLAY: CollectionDisplay = {
	view: 'grid',
	labels: ['tags'],
	sort: DEFAULT_SORT
};

/** The effective display settings for a collection (fills in defaults). */
export function collectionDisplay(collection: Collection | null | undefined): CollectionDisplay {
	return {
		view: collection?.display?.view ?? DEFAULT_DISPLAY.view,
		labels: collection?.display?.labels ?? DEFAULT_DISPLAY.labels,
		sort: collection?.display?.sort ?? DEFAULT_SORT
	};
}

export interface SortOption {
	key: SortKey;
	name: string;
}

/** Sort keys offered in the collection view picker. */
export const SORT_OPTIONS: SortOption[] = [
	{ key: 'createdAt', name: 'Date added' },
	{ key: 'name', name: 'Name' },
	{ key: 'price', name: 'Price' },
	{ key: 'quantity', name: 'Quantity' }
];

/**
 * Return a sorted copy of `items`. Missing prices always sort last regardless of
 * direction; ties fall back to newest-first so ordering is stable.
 */
export function sortItems(items: Item[], sort: CollectionSort): Item[] {
	const dir = sort.dir === 'asc' ? 1 : -1;
	const byCreatedDesc = (a: Item, b: Item) => b.createdAt.localeCompare(a.createdAt);
	return [...items].sort((a, b) => {
		let cmp = 0;
		switch (sort.key) {
			case 'name':
				cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) * dir;
				break;
			case 'quantity':
				cmp = (a.quantity - b.quantity) * dir;
				break;
			case 'price': {
				const pa = a.acquisitionPrice;
				const pb = b.acquisitionPrice;
				if (pa === null && pb === null) cmp = 0;
				else if (pa === null) return 1; // nulls last
				else if (pb === null) return -1;
				else cmp = (pa - pb) * dir;
				break;
			}
			case 'createdAt':
				cmp = a.createdAt.localeCompare(b.createdAt) * dir;
				break;
		}
		return cmp !== 0 ? cmp : byCreatedDesc(a, b);
	});
}

export interface LabelOption {
	key: string;
	name: string;
}

const BUILTIN_LABELS: LabelOption[] = [
	{ key: 'price', name: 'Price' },
	{ key: 'soldPrice', name: 'Sold price' },
	{ key: 'quantity', name: 'Quantity' },
	{ key: 'status', name: 'Status' },
	{ key: 'condition', name: 'Condition' },
	{ key: 'acquisitionDate', name: 'Purchase date' },
	{ key: 'tags', name: 'Tags' }
];

/** Everything the user can pick as an item label: built-ins + this collection's fields. */
export function labelOptions(collection: Collection | null | undefined): LabelOption[] {
	const custom = (collection?.fields ?? []).map((f) => ({ key: `cf:${f.id}`, name: f.label }));
	return [...BUILTIN_LABELS, ...custom];
}

/**
 * Render the configured labels for one item as short text chips.
 * Labels without a value on this item are skipped.
 */
export function itemChips(
	item: Item,
	labels: string[],
	collection: Collection | null | undefined,
	defaultCurrency: string
): string[] {
	const currency = item.currency ?? defaultCurrency;
	const chips: string[] = [];
	for (const key of labels) {
		let text: string | null = null;
		if (key === 'price') {
			text = item.acquisitionPrice === null ? null : formatMoney(item.acquisitionPrice, currency);
		} else if (key === 'soldPrice') {
			text = item.soldPrice === null ? null : formatMoney(item.soldPrice, currency);
		} else if (key === 'quantity') {
			text = `×${item.quantity}`;
		} else if (key === 'status') {
			text = item.status.charAt(0).toUpperCase() + item.status.slice(1);
		} else if (key === 'condition') {
			text = item.condition;
		} else if (key === 'acquisitionDate') {
			text = item.acquisitionDate;
		} else if (key === 'tags') {
			text = item.tags.length ? item.tags.map((t) => `#${t}`).join(' ') : null;
		} else if (key.startsWith('cf:')) {
			const field = collection?.fields.find((f) => f.id === key.slice(3));
			const value = field ? item.customFields[field.label] : undefined;
			text = value?.trim() ? value : null;
		}
		if (text) chips.push(text);
	}
	return chips;
}
