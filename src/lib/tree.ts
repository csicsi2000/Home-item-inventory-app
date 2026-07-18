/** Folder-tree helpers over the flat collections list (parentId nesting). */

import type { Collection, UUID } from '$lib/db/types';

const byCreated = (a: Collection, b: Collection) => a.createdAt.localeCompare(b.createdAt);

/** Direct children of `parentId` (use `null` for top-level), oldest first. */
export function childrenOf(collections: Collection[], parentId: UUID | null): Collection[] {
	return collections.filter((c) => (c.parentId ?? null) === parentId).sort(byCreated);
}

/** Ancestor chain from the root down to (but not including) `id`. */
export function ancestorsOf(collections: Collection[], id: UUID): Collection[] {
	const byId = new Map(collections.map((c) => [c.id, c]));
	const chain: Collection[] = [];
	let cur = byId.get(id);
	cur = cur?.parentId ? byId.get(cur.parentId) : undefined;
	while (cur) {
		chain.unshift(cur);
		cur = cur.parentId ? byId.get(cur.parentId) : undefined;
	}
	return chain;
}

/** `id` plus every collection nested beneath it (any depth). */
export function descendantIds(
	collections: Collection[],
	id: UUID,
	includeSelf = true
): Set<UUID> {
	const result = new Set<UUID>(includeSelf ? [id] : []);
	const stack: UUID[] = [id];
	while (stack.length) {
		const parent = stack.pop()!;
		for (const c of collections) {
			if ((c.parentId ?? null) === parent && !result.has(c.id)) {
				result.add(c.id);
				stack.push(c.id);
			}
		}
	}
	return result;
}

/** Roll direct per-collection counts up so each collection includes its descendants. */
export function rollupCounts(
	collections: Collection[],
	direct: Record<string, number>
): Record<string, number> {
	const out: Record<string, number> = {};
	for (const c of collections) {
		let total = 0;
		for (const id of descendantIds(collections, c.id)) total += direct[id] ?? 0;
		out[c.id] = total;
	}
	return out;
}

export interface TreeRow {
	collection: Collection;
	depth: number;
}

/** Depth-first flatten in tree order, tagging each node with its depth. */
export function flattenTree(collections: Collection[]): TreeRow[] {
	const out: TreeRow[] = [];
	const walk = (parentId: UUID | null, depth: number) => {
		for (const collection of childrenOf(collections, parentId)) {
			out.push({ collection, depth });
			walk(collection.id, depth + 1);
		}
	};
	walk(null, 0);
	return out;
}
