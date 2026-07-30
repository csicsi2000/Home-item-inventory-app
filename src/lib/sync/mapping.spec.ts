import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '$lib/db/schema';
import { addPhoto, createCollection, createItem, updateItem } from '$lib/db/repo';
import type { Collection } from '$lib/db/types';
import {
	PUSH_COLUMNS,
	applyWithLww,
	collectionsSync,
	itemsSync,
	photosSync,
	sortParentsFirst,
	type RemoteRow
} from './mapping';

beforeEach(async () => {
	await Promise.all(db.tables.map((t) => t.clear()));
});

const image = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });

/** What the server adds on top of what we push. */
const asRemote = (row: RemoteRow, ts = '2026-01-01 00:00:00+00'): RemoteRow => ({
	...row,
	user_id: 'user-1',
	server_updated_at: ts
});

describe('push/pull round trip', () => {
	// A dropped or misspelled column here silently loses the value on every other
	// device, which is the exact failure mode AGENTS.md's "changing a synced
	// field" checklist exists to prevent.
	it('preserves every collection field', async () => {
		const created = await createCollection({
			name: 'Trading cards',
			icon: '🃏',
			description: 'The good ones',
			fields: [{ id: 'f1', label: 'Set', type: 'text' }],
			display: { view: 'list', labels: ['price'], sort: { key: 'name', dir: 'asc' } }
		});
		const [dirty] = await collectionsSync.dirtyRows();
		await collectionsSync.clearDirty(dirty.id, dirty.updatedAt);

		await collectionsSync.applyRemote(asRemote(dirty.row));

		const pulled = (await db.collections.get(created.id))!;
		expect(pulled).toEqual({ ...created, ownerId: 'user-1', dirty: 0 });
	});

	it('preserves every item field', async () => {
		const collection = await createCollection({ name: 'Cards' });
		const created = await createItem({
			collectionId: collection.id,
			name: 'Charizard',
			description: 'Holo',
			quantity: 3,
			status: 'sold',
			condition: 'mint',
			tags: ['rare', 'holo'],
			barcode: '0123456789012',
			ocrText: 'CHARIZARD 4/102',
			acquisitionPrice: 12.5,
			acquisitionDate: '2026-01-02',
			soldPrice: 400,
			soldDate: '2026-03-04',
			currency: 'CHF',
			customFields: { Set: 'Base' }
		});
		const [dirty] = await itemsSync.dirtyRows();
		await itemsSync.clearDirty(dirty.id, dirty.updatedAt);

		await itemsSync.applyRemote(asRemote(dirty.row));

		expect(await db.items.get(created.id)).toEqual({ ...created, dirty: 0 });
	});

	it('preserves photo metadata and keeps the local image data', async () => {
		const collection = await createCollection({ name: 'Cards' });
		const item = await createItem({ collectionId: collection.id, name: 'Card' });
		const created = await addPhoto(item.id, {
			blob: image(),
			thumb: image(),
			width: 1600,
			height: 1200
		});
		const [dirty] = await photosSync.dirtyRows();
		await photosSync.clearDirty(dirty.id, dirty.updatedAt);

		await photosSync.applyRemote(asRemote(dirty.row));

		const pulled = (await db.photos.get(created.id))!;
		expect(pulled).toEqual({ ...created, dirty: 0 });
		expect(pulled.blob).toBeInstanceOf(Blob);
		expect(pulled.thumb).toBeInstanceOf(Blob);
	});
});

describe('push column coverage', () => {
	it.each([
		['collections', collectionsSync, async () => void (await createCollection({ name: 'C' }))],
		[
			'items',
			itemsSync,
			async () => {
				const c = await createCollection({ name: 'C' });
				await createItem({ collectionId: c.id, name: 'I' });
			}
		],
		[
			'item_photos',
			photosSync,
			async () => {
				const c = await createCollection({ name: 'C' });
				const i = await createItem({ collectionId: c.id, name: 'I' });
				await addPhoto(i.id, { blob: image(), thumb: image(), width: 1, height: 1 });
			}
		]
	])('%s pushes exactly the documented columns', async (name, sync, seed) => {
		await seed();
		const [dirty] = await sync.dirtyRows();
		expect(Object.keys(dirty.row).sort()).toEqual(PUSH_COLUMNS[name]);
	});
});

describe('PostgREST value coercion', () => {
	const baseItem = (overrides: RemoteRow): RemoteRow => ({
		id: 'i1',
		collection_id: 'c1',
		name: 'Item',
		created_at: '2026-01-01T00:00:00.000Z',
		updated_at: '2026-01-01T00:00:00.000Z',
		deleted_at: null,
		...overrides
	});

	it('parses numeric columns, which arrive as strings', async () => {
		await itemsSync.applyRemote(baseItem({ acquisition_price: '12.50', sold_price: '400.00' }));

		const item = (await db.items.get('i1'))!;
		expect(item.acquisitionPrice).toBe(12.5);
		expect(item.soldPrice).toBe(400);
	});

	it('keeps a null price null rather than coercing it to 0', async () => {
		await itemsSync.applyRemote(baseItem({ acquisition_price: null, sold_price: null }));

		const item = (await db.items.get('i1'))!;
		expect(item.acquisitionPrice).toBeNull();
		expect(item.soldPrice).toBeNull();
	});

	it('substitutes empty containers for missing json/array columns', async () => {
		await itemsSync.applyRemote(baseItem({ tags: null, custom_fields: null }));
		await collectionsSync.applyRemote({
			id: 'c1',
			name: 'C',
			created_at: '2026-01-01T00:00:00.000Z',
			updated_at: '2026-01-01T00:00:00.000Z',
			deleted_at: null,
			fields: null,
			display: null
		});

		expect((await db.items.get('i1'))!.tags).toEqual([]);
		expect((await db.items.get('i1'))!.customFields).toEqual({});
		expect((await db.collections.get('c1'))!.fields).toEqual([]);
		expect((await db.collections.get('c1'))!.display).toBeNull();
	});

	it('normalizes timestamps and leaves a null tombstone null', async () => {
		await itemsSync.applyRemote(baseItem({ updated_at: '2026-01-01 00:00:00+00' }));

		const item = (await db.items.get('i1'))!;
		expect(item.updatedAt).toBe('2026-01-01T00:00:00.000Z');
		expect(item.deletedAt).toBeNull();
	});
});

describe('applyWithLww', () => {
	const row = (updatedAt: string, dirty: 0 | 1) => ({ id: 'x', updatedAt, dirty, value: 'local' });

	const run = async (local: ReturnType<typeof row> | undefined, remoteUpdatedAt: string) => {
		const store = new Map(local ? [['x', local]] : []);
		const table = {
			get: async (id: string) => store.get(id),
			put: async (r: ReturnType<typeof row>) => store.set(r.id, r)
		};
		await applyWithLww(table, 'x', remoteUpdatedAt, () => ({
			id: 'x',
			updatedAt: remoteUpdatedAt,
			dirty: 0 as const,
			value: 'remote'
		}));
		return store.get('x')!.value;
	};

	it('inserts a row this device has never seen', async () => {
		expect(await run(undefined, '2026-02-01T00:00:00Z')).toBe('remote');
	});

	it('lets a newer remote overwrite a clean local row', async () => {
		expect(await run(row('2026-01-01T00:00:00Z', 0), '2026-02-01T00:00:00Z')).toBe('remote');
	});

	it('lets a newer remote overwrite an older unpushed local edit', async () => {
		// documents the last-write-wins tradeoff: the local edit is dropped
		expect(await run(row('2026-01-01T00:00:00Z', 1), '2026-02-01T00:00:00Z')).toBe('remote');
	});

	it('keeps an unpushed local edit that is newer', async () => {
		expect(await run(row('2026-03-01T00:00:00Z', 1), '2026-02-01T00:00:00Z')).toBe('local');
	});

	it('keeps the local row on an exact timestamp tie', async () => {
		expect(await run(row('2026-02-01T00:00:00Z', 1), '2026-02-01T00:00:00Z')).toBe('local');
	});

	it('overwrites a clean local row even on a tie', async () => {
		expect(await run(row('2026-02-01T00:00:00Z', 0), '2026-02-01T00:00:00Z')).toBe('remote');
	});

	it('does not resurrect a locally-tombstoned item from a stale remote row', async () => {
		const collection = await createCollection({ name: 'Cards' });
		const item = await createItem({ collectionId: collection.id, name: 'Card' });
		await updateItem(item.id, { name: 'Renamed' });

		await itemsSync.applyRemote({
			id: item.id,
			collection_id: collection.id,
			name: 'Card',
			created_at: item.createdAt,
			updated_at: item.updatedAt,
			deleted_at: null
		});

		expect((await db.items.get(item.id))!.name).toBe('Renamed');
	});
});

describe('sortParentsFirst', () => {
	const collection = (id: string, parentId: string | null): Collection => ({
		id,
		name: id,
		parentId,
		icon: null,
		description: null,
		fields: [],
		display: null,
		createdAt: '2026-01-01T00:00:00.000Z',
		updatedAt: '2026-01-01T00:00:00.000Z',
		deletedAt: null,
		dirty: 1
	});

	const precedes = (ordered: Collection[], parent: string, child: string) =>
		ordered.findIndex((c) => c.id === parent) < ordered.findIndex((c) => c.id === child);

	it('emits a parent before a child listed first', () => {
		const ordered = sortParentsFirst([collection('child', 'parent'), collection('parent', null)]);
		expect(ordered.map((c) => c.id)).toEqual(['parent', 'child']);
	});

	it('orders a three-level chain top-down', () => {
		const ordered = sortParentsFirst([
			collection('c', 'b'),
			collection('b', 'a'),
			collection('a', null)
		]);
		expect(ordered.map((c) => c.id)).toEqual(['a', 'b', 'c']);
	});

	it('terminates on a parent cycle and emits each row once', () => {
		const ordered = sortParentsFirst([collection('a', 'b'), collection('b', 'a')]);
		expect(ordered.map((c) => c.id).sort()).toEqual(['a', 'b']);
	});

	it('passes through a child whose parent is not in the dirty set', () => {
		const ordered = sortParentsFirst([collection('child', 'absent-parent')]);
		expect(ordered.map((c) => c.id)).toEqual(['child']);
	});

	it('emits every parent before its children for a shuffled tree', () => {
		const rows: Collection[] = [collection('root', null)];
		for (let i = 0; i < 30; i++) {
			const parent = rows[i % rows.length].id;
			rows.push(collection(`n${i}`, parent));
		}
		const shuffled = [...rows].reverse();

		const ordered = sortParentsFirst(shuffled);

		expect(ordered).toHaveLength(rows.length);
		for (const c of rows) {
			if (c.parentId) expect(precedes(ordered, c.parentId, c.id)).toBe(true);
		}
	});
});

describe('dirtyRows', () => {
	it('only reports rows with unpushed changes', async () => {
		const collection = await createCollection({ name: 'Cards' });
		const clean = await createItem({ collectionId: collection.id, name: 'Clean' });
		const dirtyItem = await createItem({ collectionId: collection.id, name: 'Dirty' });
		await db.items.update(clean.id, { dirty: 0 });

		const rows = await itemsSync.dirtyRows();

		expect(rows.map((r) => r.id)).toEqual([dirtyItem.id]);
	});

	it('does not clear the dirty flag when the row changed during the push', async () => {
		const collection = await createCollection({ name: 'Cards' });
		const item = await createItem({ collectionId: collection.id, name: 'Card' });
		const [dirty] = await itemsSync.dirtyRows();
		// user edits again while the request is in flight
		await updateItem(item.id, { name: 'Edited mid-flight' });

		await itemsSync.clearDirty(dirty.id, dirty.updatedAt);

		expect((await db.items.get(item.id))!.dirty).toBe(1);
	});

	it('sorts dirty collections parents-first for the RLS parent check', async () => {
		const parent = await createCollection({ name: 'Parent' });
		const child = await createCollection({ name: 'Child', parentId: parent.id });
		await db.collections.update(parent.id, { updatedAt: '2999-01-01T00:00:00.000Z' });

		const rows = await collectionsSync.dirtyRows();

		expect(rows.map((r) => r.id)).toEqual([parent.id, child.id]);
	});
});
