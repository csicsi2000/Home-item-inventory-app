import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './schema';
import {
	addPhoto,
	bumpQuantity,
	createCollection,
	createItem,
	deleteCollection,
	deleteItem,
	deletePhoto,
	markStatus,
	primaryPhoto,
	purgeTombstones,
	updateItem
} from './repo';

const makeBlob = () => new Blob(['x'], { type: 'image/webp' });

beforeEach(async () => {
	await Promise.all(db.tables.map((t) => t.clear()));
});

describe('repo', () => {
	it('creates entities stamped dirty with sync metadata', async () => {
		const collection = await createCollection({ name: 'Cards' });
		const item = await createItem({ collectionId: collection.id, name: 'Vader' });

		expect(collection.dirty).toBe(1);
		expect(collection.deletedAt).toBeNull();
		expect(item.dirty).toBe(1);
		expect(item.quantity).toBe(1);
		expect(item.status).toBe('owned');
		expect(Date.parse(item.updatedAt)).not.toBeNaN();
	});

	it('updates bump updatedAt and re-mark dirty', async () => {
		const c = await createCollection({ name: 'Cards' });
		const item = await createItem({ collectionId: c.id, name: 'Vader' });
		await db.items.update(item.id, { dirty: 0 });

		await new Promise((r) => setTimeout(r, 5));
		await updateItem(item.id, { name: 'Darth Vader' });

		const updated = (await db.items.get(item.id))!;
		expect(updated.name).toBe('Darth Vader');
		expect(updated.dirty).toBe(1);
		expect(updated.updatedAt > item.updatedAt).toBe(true);
	});

	it('tombstones items with their photos and hard-deletes embeddings', async () => {
		const c = await createCollection({ name: 'Cards' });
		const item = await createItem({ collectionId: c.id, name: 'Vader' });
		await addPhoto(item.id, { blob: makeBlob(), thumb: makeBlob(), width: 10, height: 10 });
		await db.embeddings.add({
			itemId: item.id,
			phash: 'ff00ff00ff00ff00',
			vector: new Float32Array(4),
			updatedAt: new Date().toISOString(),
			dirty: 0
		});

		await deleteItem(item.id);

		const deleted = (await db.items.get(item.id))!;
		expect(deleted.deletedAt).not.toBeNull();
		expect(deleted.dirty).toBe(1);
		const photos = await db.photos.where('itemId').equals(item.id).toArray();
		expect(photos.every((p) => p.deletedAt !== null)).toBe(true);
		expect(await db.embeddings.get(item.id)).toBeUndefined();
	});

	it('deleting a collection tombstones its items', async () => {
		const c = await createCollection({ name: 'Cards' });
		const item = await createItem({ collectionId: c.id, name: 'Vader' });

		await deleteCollection(c.id);

		expect((await db.collections.get(c.id))!.deletedAt).not.toBeNull();
		expect((await db.items.get(item.id))!.deletedAt).not.toBeNull();
	});

	it('quantity bumps never drop below 1', async () => {
		const c = await createCollection({ name: 'Cards' });
		const item = await createItem({ collectionId: c.id, name: 'Vader', quantity: 2 });

		await bumpQuantity(item.id, 1);
		expect((await db.items.get(item.id))!.quantity).toBe(3);
		await bumpQuantity(item.id, -5);
		expect((await db.items.get(item.id))!.quantity).toBe(1);
	});

	it('marks items sold with a default sold date and clears it when un-sold', async () => {
		const c = await createCollection({ name: 'Cards' });
		const item = await createItem({ collectionId: c.id, name: 'Vader' });

		await markStatus(item.id, 'sold', { soldPrice: 25 });
		let updated = (await db.items.get(item.id))!;
		expect(updated.status).toBe('sold');
		expect(updated.soldPrice).toBe(25);
		expect(updated.soldDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

		await markStatus(item.id, 'owned');
		updated = (await db.items.get(item.id))!;
		expect(updated.status).toBe('owned');
		expect(updated.soldDate).toBeNull();
	});

	it('first photo becomes primary; deleting it promotes the next one', async () => {
		const c = await createCollection({ name: 'Cards' });
		const item = await createItem({ collectionId: c.id, name: 'Vader' });
		const p1 = await addPhoto(item.id, { blob: makeBlob(), thumb: makeBlob(), width: 1, height: 1 });
		const p2 = await addPhoto(item.id, { blob: makeBlob(), thumb: makeBlob(), width: 1, height: 1 });

		expect(p1.isPrimary).toBe(true);
		expect(p2.isPrimary).toBe(false);

		await deletePhoto(p1.id);
		const promoted = await primaryPhoto(item.id);
		expect(promoted?.id).toBe(p2.id);
	});

	it('purges only old, already-pushed tombstones', async () => {
		const c = await createCollection({ name: 'Cards' });
		const oldDate = new Date(Date.now() - 60 * 86_400_000).toISOString();
		const freshItem = await createItem({ collectionId: c.id, name: 'fresh tombstone' });
		await deleteItem(freshItem.id);
		await db.items.add({
			...freshItem,
			id: crypto.randomUUID(),
			name: 'old pushed tombstone',
			deletedAt: oldDate,
			updatedAt: oldDate,
			dirty: 0
		});
		await db.items.add({
			...freshItem,
			id: crypto.randomUUID(),
			name: 'old unpushed tombstone',
			deletedAt: oldDate,
			updatedAt: oldDate,
			dirty: 1
		});

		const purged = await purgeTombstones(30);

		expect(purged).toBe(1);
		const remaining = await db.items.toArray();
		expect(remaining.map((i) => i.name).sort()).toEqual([
			'fresh tombstone',
			'old unpushed tombstone'
		]);
	});
});
