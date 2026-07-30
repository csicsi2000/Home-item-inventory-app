import MiniSearch from 'minisearch';
import { db } from '$lib/db/schema';
import { onItemsChanged } from '$lib/db/repo';
import type { Item, UUID } from '$lib/db/types';

interface SearchDoc {
	id: UUID;
	name: string;
	description: string;
	tags: string;
	barcode: string;
	ocrText: string;
	custom: string;
	collectionId: UUID;
}

function toDoc(item: Item): SearchDoc {
	return {
		id: item.id,
		name: item.name,
		description: item.description ?? '',
		tags: item.tags.join(' '),
		barcode: item.barcode ?? '',
		ocrText: item.ocrText ?? '',
		custom: Object.entries(item.customFields)
			.map(([k, v]) => `${k} ${v}`)
			.join(' '),
		collectionId: item.collectionId
	};
}

let index: MiniSearch<SearchDoc> | null = null;
let building: Promise<MiniSearch<SearchDoc>> | null = null;
/** Detaches the incremental updater belonging to the current index. */
let unsubscribe: (() => void) | null = null;

async function build(): Promise<MiniSearch<SearchDoc>> {
	const ms = new MiniSearch<SearchDoc>({
		fields: ['name', 'description', 'tags', 'barcode', 'ocrText', 'custom'],
		storeFields: ['collectionId'],
		searchOptions: {
			prefix: true,
			fuzzy: 0.2,
			boost: { name: 3, tags: 2, barcode: 2 }
		}
	});
	const items = await db.items.filter((i) => !i.deletedAt).toArray();
	ms.addAll(items.map(toDoc));

	// keep the index in sync with every later write
	unsubscribe = onItemsChanged(async (ids) => {
		for (const id of ids) {
			const item = await db.items.get(id);
			if (ms.has(id)) ms.discard(id);
			if (item && !item.deletedAt) ms.add(toDoc(item));
		}
	});
	return ms;
}

/** Build lazily on first search (~50ms for a few thousand items). */
export function ensureIndex(): Promise<MiniSearch<SearchDoc>> {
	// A rejected build must not be cached: `building` would stay rejected and
	// every later search would fail with the original error for the whole session.
	building ??= build()
		.then((ms) => (index = ms))
		.catch((err) => {
			building = null;
			throw err;
		});
	return building;
}

/**
 * Drop the index so the next search rebuilds from Dexie. The incremental
 * onItemsChanged hook only touches the ids it is handed, so a wholesale wipe
 * (switching accounts) would otherwise leave the previous account's items
 * searchable.
 *
 * Detaching the updater matters as much as dropping the index: each build
 * registered a listener, so every reset left another one behind doing a Dexie
 * read per changed item to maintain an index nothing can reach any more.
 */
export function resetIndex(): void {
	unsubscribe?.();
	unsubscribe = null;
	index = null;
	building = null;
}

export interface SearchHit {
	item: Item;
	score: number;
}

export async function searchItems(
	query: string,
	opts: { collectionId?: UUID; collectionIds?: Set<UUID>; limit?: number } = {}
): Promise<SearchHit[]> {
	const ms = await ensureIndex();
	const results = ms.search(query, {
		filter: (r) => {
			if (opts.collectionId && r.collectionId !== opts.collectionId) return false;
			if (opts.collectionIds && !opts.collectionIds.has(r.collectionId as UUID)) return false;
			return true;
		}
	});
	const hits: SearchHit[] = [];
	for (const result of results.slice(0, opts.limit ?? 50)) {
		const item = await db.items.get(result.id as UUID);
		if (item && !item.deletedAt) hits.push({ item, score: result.score });
	}
	return hits;
}

export { index as _indexForTests };
