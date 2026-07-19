/** Ordering options for search results (pure, no DB access). */

import type { SearchHit } from './index';

export type SearchSortKey = 'relevance' | 'name' | 'newest' | 'price';

export interface SearchSortOption {
	key: SearchSortKey;
	name: string;
}

export const SEARCH_SORT_OPTIONS: SearchSortOption[] = [
	{ key: 'relevance', name: 'Relevance' },
	{ key: 'name', name: 'Name' },
	{ key: 'newest', name: 'Newest' },
	{ key: 'price', name: 'Price' }
];

/**
 * Return a sorted copy of `hits`. 'relevance' keeps MiniSearch's score order;
 * 'price' puts items without a price last. Ties fall back to score so ordering
 * is stable.
 */
export function sortHits(hits: SearchHit[], key: SearchSortKey): SearchHit[] {
	if (key === 'relevance') return [...hits];
	const byScore = (a: SearchHit, b: SearchHit) => b.score - a.score;
	return [...hits].sort((a, b) => {
		let cmp = 0;
		switch (key) {
			case 'name':
				cmp = a.item.name.localeCompare(b.item.name, undefined, { sensitivity: 'base' });
				break;
			case 'newest':
				cmp = b.item.createdAt.localeCompare(a.item.createdAt);
				break;
			case 'price': {
				const pa = a.item.acquisitionPrice;
				const pb = b.item.acquisitionPrice;
				if (pa === null && pb === null) cmp = 0;
				else if (pa === null) return 1; // nulls last
				else if (pb === null) return -1;
				else cmp = pb - pa; // high to low
				break;
			}
		}
		return cmp !== 0 ? cmp : byScore(a, b);
	});
}
