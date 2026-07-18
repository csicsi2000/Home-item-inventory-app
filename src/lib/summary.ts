/** Aggregate stats for a set of items — powers the collection summary strip. */

import type { Item } from '$lib/db/types';

export interface CurrencyTotal {
	currency: string;
	total: number;
}

export interface CollectionSummary {
	/** Distinct item records. */
	items: number;
	/** Total pieces, counting each item's quantity. */
	pieces: number;
	/** Acquisition value (price × quantity), grouped by currency, largest first. */
	value: CurrencyTotal[];
	/** Proceeds from sold items, grouped by currency. */
	sold: CurrencyTotal[];
}

const toSorted = (m: Map<string, number>): CurrencyTotal[] =>
	[...m.entries()]
		.map(([currency, total]) => ({ currency, total }))
		.sort((a, b) => b.total - a.total);

export function summarizeItems(items: Item[], defaultCurrency: string): CollectionSummary {
	const value = new Map<string, number>();
	const sold = new Map<string, number>();
	let pieces = 0;

	for (const item of items) {
		const currency = item.currency ?? defaultCurrency;
		pieces += item.quantity;
		if (item.acquisitionPrice !== null) {
			value.set(currency, (value.get(currency) ?? 0) + item.acquisitionPrice * item.quantity);
		}
		if (item.soldPrice !== null) {
			sold.set(currency, (sold.get(currency) ?? 0) + item.soldPrice);
		}
	}

	return { items: items.length, pieces, value: toSorted(value), sold: toSorted(sold) };
}
