import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppDatabase, db } from './schema';
import { addPhoto, createCollection, createItem, deleteItem } from './repo';

beforeEach(async () => {
	await Promise.all(db.tables.map((t) => t.clear()));
});

const image = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });
const photoData = () => ({ blob: image(), thumb: image(), width: 100, height: 100 });

describe('v3 tombstone indexes', () => {
	// IndexedDB refuses null as a key, so rows with deletedAt === null are simply
	// absent from the index. That is what makes `.above('')` a tombstone-only
	// query, and it's what lets the sync engine stop full-scanning (and
	// deserializing every photo Blob) on every tick.
	it('indexes only tombstoned items, not live ones', async () => {
		const collection = await createCollection({ name: 'Cards' });
		const live = await createItem({ collectionId: collection.id, name: 'Keeper' });
		const gone = await createItem({ collectionId: collection.id, name: 'Doomed' });
		await deleteItem(gone.id);

		const tombstoned = await db.items.where('deletedAt').above('').toArray();

		expect(tombstoned.map((i) => i.id)).toEqual([gone.id]);
		expect(await db.items.count()).toBe(2);
		expect((await db.items.get(live.id))!.deletedAt).toBeNull();
	});

	it('indexes only photos that have a storage object', async () => {
		const collection = await createCollection({ name: 'Cards' });
		const item = await createItem({ collectionId: collection.id, name: 'Card' });
		const localOnly = await addPhoto(item.id, photoData());
		const synced = await addPhoto(item.id, photoData());
		await db.photos.update(synced.id, { storagePath: 'user-1/photo.webp' });

		const withObjects = await db.photos.where('storagePath').above('').toArray();

		expect(withObjects.map((p) => p.id)).toEqual([synced.id]);
		expect((await db.photos.get(localOnly.id))!.storagePath).toBeNull();
	});

	it('finds photo tombstones without scanning live rows', async () => {
		const collection = await createCollection({ name: 'Cards' });
		const keep = await createItem({ collectionId: collection.id, name: 'Keeper' });
		await addPhoto(keep.id, photoData());
		const gone = await createItem({ collectionId: collection.id, name: 'Doomed' });
		await addPhoto(gone.id, photoData());
		await addPhoto(gone.id, photoData());
		await deleteItem(gone.id); // tombstones the item and both its photos

		const tombstoned = await db.photos.where('deletedAt').above('').toArray();

		expect(tombstoned).toHaveLength(2);
		expect(tombstoned.every((p) => p.itemId === gone.id)).toBe(true);
	});
});

describe('v3 upgrade', () => {
	it('clears stale pull cursors so keyset pagination restarts from epoch', async () => {
		const name = `upgrade-test-${Math.random().toString(36).slice(2)}`;

		// a device still on the old schema, part-way through syncing
		const old = new Dexie(name);
		old.version(1).stores({
			collections: 'id, dirty, deletedAt',
			items: 'id, collectionId, dirty, barcode, status, *tags',
			photos: 'id, itemId, dirty, uploaded',
			embeddings: 'itemId, dirty',
			syncState: 'table'
		});
		old.version(2).stores({ shares: 'collectionId' });
		await old.open();
		await old.table('syncState').put({ table: 'items', lastPulledAt: '2026-01-01T00:00:00.000Z' });
		await old.table('collections').put({
			id: 'c1',
			name: 'Survives',
			parentId: null,
			icon: null,
			description: null,
			fields: [],
			display: null,
			createdAt: '2026-01-01T00:00:00.000Z',
			updatedAt: '2026-01-01T00:00:00.000Z',
			deletedAt: null,
			dirty: 0
		});
		old.close();

		const upgraded = new AppDatabase(name);
		await upgraded.open();

		expect(upgraded.verno).toBe(3);
		expect(await upgraded.syncState.count()).toBe(0);
		// user data is untouched — only the cursor is reset
		expect((await upgraded.collections.get('c1'))!.name).toBe('Survives');

		upgraded.close();
		await Dexie.delete(name);
	});
});
