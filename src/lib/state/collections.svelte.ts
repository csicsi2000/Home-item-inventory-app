import { db } from '$lib/db/schema';
import type { Collection } from '$lib/db/types';
import { Live } from './live.svelte';

export const collectionsLive = new Live<Collection[]>(
	() =>
		db.collections
			.filter((c) => !c.deletedAt)
			.toArray()
			.then((list) => list.sort((a, b) => a.createdAt.localeCompare(b.createdAt))),
	[]
);

/** collectionId → live (non-deleted) item count */
export const itemCountsLive = new Live<Record<string, number>>(async () => {
	const counts: Record<string, number> = {};
	await db.items
		.filter((i) => !i.deletedAt)
		.each((i) => {
			counts[i.collectionId] = (counts[i.collectionId] ?? 0) + 1;
		});
	return counts;
}, {});
