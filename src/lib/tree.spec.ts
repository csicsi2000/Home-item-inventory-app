import { describe, it, expect } from 'vitest';
import { ancestorsOf, childrenOf, descendantIds, flattenTree, rollupCounts } from './tree';
import type { Collection } from './db/types';

const mk = (id: string, parentId: string | null, createdAt = '2026-01-01'): Collection => ({
	id,
	name: id,
	parentId,
	icon: null,
	description: null,
	fields: [],
	display: null,
	createdAt,
	updatedAt: createdAt,
	deletedAt: null,
	dirty: 0
});

// root -> a -> a1, a2 ; root -> b
const tree = [
	mk('root', null, '2026-01-01'),
	mk('a', 'root', '2026-01-02'),
	mk('a1', 'a', '2026-01-03'),
	mk('a2', 'a', '2026-01-04'),
	mk('b', 'root', '2026-01-05')
];

describe('childrenOf', () => {
	it('returns direct children only, oldest first', () => {
		expect(childrenOf(tree, 'a').map((c) => c.id)).toEqual(['a1', 'a2']);
		expect(childrenOf(tree, null).map((c) => c.id)).toEqual(['root']);
		expect(childrenOf(tree, 'a1')).toEqual([]);
	});
});

describe('ancestorsOf', () => {
	it('walks from the root down to the parent', () => {
		expect(ancestorsOf(tree, 'a1').map((c) => c.id)).toEqual(['root', 'a']);
		expect(ancestorsOf(tree, 'root')).toEqual([]);
	});
});

describe('descendantIds', () => {
	it('includes self and every nested collection', () => {
		expect([...descendantIds(tree, 'root')].sort()).toEqual(['a', 'a1', 'a2', 'b', 'root']);
		expect([...descendantIds(tree, 'a')].sort()).toEqual(['a', 'a1', 'a2']);
	});

	it('can exclude self', () => {
		expect([...descendantIds(tree, 'a', false)].sort()).toEqual(['a1', 'a2']);
	});
});

describe('rollupCounts', () => {
	it('sums each collection with all of its descendants', () => {
		const direct = { root: 1, a: 2, a1: 3, a2: 4, b: 5 };
		const rolled = rollupCounts(tree, direct);
		expect(rolled.a).toBe(2 + 3 + 4);
		expect(rolled.root).toBe(1 + 2 + 3 + 4 + 5);
		expect(rolled.a1).toBe(3);
	});
});

describe('flattenTree', () => {
	it('emits depth-first order with depth tags', () => {
		expect(flattenTree(tree).map((r) => [r.collection.id, r.depth])).toEqual([
			['root', 0],
			['a', 1],
			['a1', 2],
			['a2', 2],
			['b', 1]
		]);
	});
});
