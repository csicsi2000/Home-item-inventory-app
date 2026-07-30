import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/schema';
import { addPhoto, createCollection, createItem, deletePhoto, purgeTombstones } from '$lib/db/repo';

const h = vi.hoisted(() => ({
	removed: [] as string[][],
	removeError: null as { message: string } | null,
	uploaded: [] as string[],
	uploadError: null as { message: string } | null
}));

vi.mock('./supabase', () => ({
	syncConfigured: true,
	supabase: {
		storage: {
			from: () => ({
				remove: async (paths: string[]) => {
					h.removed.push(paths);
					return { data: null, error: h.removeError };
				},
				upload: async (path: string) => {
					h.uploaded.push(path);
					return { data: null, error: h.uploadError };
				}
			})
		}
	}
}));

import { removeDeletedPhotoObjects, uploadPendingPhotos } from './imageQueue';

beforeEach(async () => {
	await Promise.all(db.tables.map((t) => t.clear()));
	h.removed = [];
	h.removeError = null;
	h.uploaded = [];
	h.uploadError = null;
});

const image = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });

async function tombstonedPhoto(opts: { dirty: 0 | 1; ageDays: number }) {
	const collection = await createCollection({ name: 'Cards' });
	const item = await createItem({ collectionId: collection.id, name: 'Card' });
	const photo = await addPhoto(item.id, { blob: image(), thumb: image(), width: 1, height: 1 });
	await db.photos.update(photo.id, {
		storagePath: `user-1/${photo.id}.webp`,
		uploaded: 1
	});
	await deletePhoto(photo.id);
	await db.photos.update(photo.id, {
		dirty: opts.dirty,
		deletedAt: new Date(Date.now() - opts.ageDays * 86_400_000).toISOString()
	});
	return photo.id;
}

describe('removeDeletedPhotoObjects', () => {
	// The bug: the object was deleted on the sync *before* the tombstone was
	// pushed, so other devices kept a row with a live storage_path pointing at
	// nothing and their hydration 404'd forever.
	it('leaves the object alone while the tombstone is still unpushed', async () => {
		await tombstonedPhoto({ dirty: 1, ageDays: 45 });

		await removeDeletedPhotoObjects();

		expect(h.removed).toEqual([]);
	});

	it('keeps the cloud copy during the restore window', async () => {
		await tombstonedPhoto({ dirty: 0, ageDays: 3 });

		await removeDeletedPhotoObjects();

		expect(h.removed).toEqual([]);
	});

	it('removes the object once the tombstone is pushed and expired', async () => {
		const id = await tombstonedPhoto({ dirty: 0, ageDays: 45 });

		await removeDeletedPhotoObjects();

		expect(h.removed).toEqual([[`user-1/${id}.webp`]]);
		// uploaded flips back to 0, which is what lets purgeTombstones drop the row
		expect((await db.photos.get(id))!.uploaded).toBe(0);
	});

	it('leaves the row alone when the server refuses the delete', async () => {
		const id = await tombstonedPhoto({ dirty: 0, ageDays: 45 });
		h.removeError = { message: 'nope' };

		await removeDeletedPhotoObjects();

		expect((await db.photos.get(id))!.uploaded).toBe(1);
	});
});

describe('purgeTombstones and storage objects', () => {
	it('keeps a photo row until its storage object has been removed', async () => {
		// the row is the only record of the object's path — purging it first would
		// orphan the object in the bucket forever
		const id = await tombstonedPhoto({ dirty: 0, ageDays: 45 });

		await purgeTombstones();

		expect(await db.photos.get(id)).toBeDefined();
	});

	it('purges the row once the object is gone', async () => {
		const id = await tombstonedPhoto({ dirty: 0, ageDays: 45 });
		await removeDeletedPhotoObjects();

		await purgeTombstones();

		expect(await db.photos.get(id)).toBeUndefined();
	});

	it('eventually purges a row whose object can never be deleted', async () => {
		const id = await tombstonedPhoto({ dirty: 0, ageDays: 400 });

		await purgeTombstones();

		expect(await db.photos.get(id)).toBeUndefined();
	});

	it('still purges expired item tombstones', async () => {
		const collection = await createCollection({ name: 'Cards' });
		const item = await createItem({ collectionId: collection.id, name: 'Card' });
		await db.items.update(item.id, {
			deletedAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
			dirty: 0
		});

		await purgeTombstones();

		expect(await db.items.get(item.id)).toBeUndefined();
	});
});

describe('uploadPendingPhotos', () => {
	it('bounds one run so a big backlog cannot monopolise the sync', async () => {
		const collection = await createCollection({ name: 'Cards' });
		const item = await createItem({ collectionId: collection.id, name: 'Card' });
		for (let i = 0; i < 25; i++) {
			await addPhoto(item.id, { blob: image(), thumb: image(), width: 1, height: 1 });
		}

		await uploadPendingPhotos('user-1');

		expect(h.uploaded).toHaveLength(20);
	});

	it('backs off a failing upload instead of retrying it every sync', async () => {
		const collection = await createCollection({ name: 'Cards' });
		const item = await createItem({ collectionId: collection.id, name: 'Card' });
		await addPhoto(item.id, { blob: image(), thumb: image(), width: 1, height: 1 });
		h.uploadError = { message: 'storage is down' };

		await uploadPendingPhotos('user-1');
		expect(h.uploaded).toHaveLength(1);

		await uploadPendingPhotos('user-1');

		expect(h.uploaded).toHaveLength(1);
		expect(await db.syncFailures.count()).toBe(1);
	});

	it('clears the backoff record after a successful upload', async () => {
		const collection = await createCollection({ name: 'Cards' });
		const item = await createItem({ collectionId: collection.id, name: 'Card' });
		const photo = await addPhoto(item.id, {
			blob: image(),
			thumb: image(),
			width: 1,
			height: 1
		});

		await uploadPendingPhotos('user-1');

		expect(await db.syncFailures.count()).toBe(0);
		const stored = (await db.photos.get(photo.id))!;
		expect(stored.uploaded).toBe(1);
		expect(stored.storagePath).toBe(`user-1/${photo.id}.webp`);
		// storagePath must reach other devices
		expect(stored.dirty).toBe(1);
	});

	it('does not report a failed photo download as an unsaved change', async () => {
		const { countFailures } = await import('./failures');
		await db.syncFailures.put({
			key: 'photo-download:p1',
			table: 'photo-download',
			rowId: 'p1',
			failedUpdatedAt: '2026-01-01T00:00:00.000Z',
			attempts: 1,
			nextAttemptAt: '2027-01-01T00:00:00.000Z',
			code: null,
			message: 'not found'
		});

		expect(await countFailures()).toBe(0);
	});
});
