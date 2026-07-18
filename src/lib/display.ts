/** Per-collection view settings + the short label chips shown on items. */

import type { Collection, CollectionDisplay, Item } from '$lib/db/types';
import { formatMoney } from '$lib/currency';

/** Matches the app's look before display settings existed. */
export const DEFAULT_DISPLAY: CollectionDisplay = { view: 'grid', labels: ['tags'] };

/** The effective display settings for a collection (fills in defaults). */
export function collectionDisplay(collection: Collection | null | undefined): CollectionDisplay {
	return {
		view: collection?.display?.view ?? DEFAULT_DISPLAY.view,
		labels: collection?.display?.labels ?? DEFAULT_DISPLAY.labels
	};
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
