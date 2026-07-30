import { db } from './schema';
import type { Collection, Item, ItemPhoto, ItemStatus, UUID } from './types';
import { descendantIds } from '$lib/tree';

let lastNow = 0;

/**
 * A strictly increasing write timestamp.
 *
 * `updatedAt` is not just a clock reading — it is the identity of a row version.
 * The push clears `dirty` only when the row's `updatedAt` still equals the one it
 * sent, which is what stops an edit made mid-flight from being marked as pushed.
 * ISO strings carry milliseconds, so two writes landing in the same millisecond
 * were indistinguishable: the second edit's dirty flag was cleared without ever
 * being sent, and that change never reached the cloud. Common in practice —
 * an edit right after a create, or any programmatic pair of writes.
 *
 * Advancing by a millisecond when the clock hasn't moved keeps every version
 * distinct and keeps last-write-wins ordering meaningful.
 */
export const now = () => new Date(nowMs()).toISOString();

/**
 * The same instant as {@link now}, as epoch milliseconds.
 *
 * Anything comparing against a stamped timestamp must read the clock through
 * here rather than `Date.now()`: bunched writes push this sequence into the raw
 * clock's future, so a wall-clock reading can land *before* a row that was
 * written moments ago.
 */
const nowMs = () => {
	lastNow = Math.max(Date.now(), lastNow + 1);
	return lastNow;
};
export const newId = () => crypto.randomUUID();

/** Fired after any write that changes items — the search index subscribes to this. */
type ItemsChangedListener = (itemIds: UUID[]) => void;
const itemListeners = new Set<ItemsChangedListener>();
export function onItemsChanged(fn: ItemsChangedListener): () => void {
	itemListeners.add(fn);
	return () => itemListeners.delete(fn);
}
export function notifyItemsChanged(ids: UUID[]) {
	for (const fn of itemListeners) fn(ids);
}

// ---------- collections ----------

export async function createCollection(
	data: Pick<Collection, 'name'> &
		Partial<Pick<Collection, 'parentId' | 'icon' | 'description' | 'fields' | 'display'>>
): Promise<Collection> {
	const t = now();
	const collection: Collection = {
		id: newId(),
		name: data.name,
		parentId: data.parentId ?? null,
		icon: data.icon ?? null,
		description: data.description ?? null,
		fields: data.fields ?? [],
		display: data.display ?? null,
		createdAt: t,
		updatedAt: t,
		deletedAt: null,
		dirty: 1
	};
	await db.collections.add(collection);
	notifyItemsChanged([]);
	return collection;
}

export async function updateCollection(
	id: UUID,
	patch: Partial<Pick<Collection, 'name' | 'parentId' | 'icon' | 'description' | 'fields' | 'display'>>
): Promise<void> {
	if (patch.parentId != null) {
		// guard against moving a collection into itself or one of its own descendants
		const all = await db.collections.filter((c) => !c.deletedAt).toArray();
		if (descendantIds(all, id).has(patch.parentId)) {
			throw new Error('Cannot move a collection into itself or its own subcollection.');
		}
	}
	await db.collections.update(id, { ...patch, updatedAt: now(), dirty: 1 });
	notifyItemsChanged([]);
}

/** Tombstones the collection, every subcollection beneath it, and all their items. */
export async function deleteCollection(id: UUID): Promise<void> {
	const t = now();
	await db.transaction('rw', [db.collections, db.items, db.photos, db.embeddings], async () => {
		const all = await db.collections.filter((c) => !c.deletedAt).toArray();
		const collectionIds = [...descendantIds(all, id)];
		const items = await db.items.where('collectionId').anyOf(collectionIds).toArray();
		const itemIds = items.filter((i) => !i.deletedAt).map((i) => i.id);
		for (const itemId of itemIds) await tombstoneItem(itemId, t);
		for (const cid of collectionIds) {
			await db.collections.update(cid, { deletedAt: t, updatedAt: t, dirty: 1 });
		}
		notifyItemsChanged(itemIds);
	});
}

export function liveCollections() {
	return db.collections.filter((c) => !c.deletedAt).toArray();
}

// ---------- items ----------

export type NewItem = Pick<Item, 'collectionId'> &
	Partial<
		Omit<Item, 'id' | 'collectionId' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'dirty'>
	>;

export async function createItem(data: NewItem): Promise<Item> {
	const t = now();
	const item: Item = {
		id: newId(),
		collectionId: data.collectionId,
		name: data.name ?? '',
		description: data.description ?? null,
		quantity: data.quantity ?? 1,
		status: data.status ?? 'owned',
		condition: data.condition ?? null,
		tags: data.tags ?? [],
		barcode: data.barcode ?? null,
		ocrText: data.ocrText ?? null,
		acquisitionPrice: data.acquisitionPrice ?? null,
		acquisitionDate: data.acquisitionDate ?? null,
		soldPrice: data.soldPrice ?? null,
		soldDate: data.soldDate ?? null,
		currency: data.currency ?? null,
		customFields: data.customFields ?? {},
		createdAt: t,
		updatedAt: t,
		deletedAt: null,
		dirty: 1
	};
	await db.items.add(item);
	notifyItemsChanged([item.id]);
	return item;
}

export async function updateItem(
	id: UUID,
	patch: Partial<Omit<Item, 'id' | 'createdAt' | 'updatedAt' | 'deletedAt' | 'dirty'>>
): Promise<void> {
	await db.items.update(id, { ...patch, updatedAt: now(), dirty: 1 });
	notifyItemsChanged([id]);
}

async function tombstoneItem(id: UUID, t: string): Promise<void> {
	await db.items.update(id, { deletedAt: t, updatedAt: t, dirty: 1 });
	await db.photos
		.where('itemId')
		.equals(id)
		.modify((photo) => {
			// Leave photos the user already deleted alone. Re-stamping them would
			// lose the time they were actually deleted, re-dirty a row that has
			// already synced, and make restoring the item resurrect photos the user
			// removed on purpose.
			if (photo.deletedAt) return;
			photo.deletedAt = t;
			photo.updatedAt = t;
			photo.dirty = 1;
		});
	await db.embeddings.where('itemId').equals(id).delete();
}

export async function deleteItem(id: UUID): Promise<void> {
	await db.transaction('rw', [db.items, db.photos, db.embeddings], () =>
		tombstoneItem(id, now())
	);
	notifyItemsChanged([id]);
}

/** Tombstone many items at once (bulk cleanup). */
export async function deleteItems(ids: UUID[]): Promise<void> {
	if (!ids.length) return;
	const t = now();
	await db.transaction('rw', [db.items, db.photos, db.embeddings], async () => {
		for (const id of ids) await tombstoneItem(id, t);
	});
	notifyItemsChanged(ids);
}

/**
 * Undo a tombstone.
 *
 * A deleted item's photos were tombstoned in the same transaction and therefore
 * carry the item's exact `deletedAt`. Matching on that timestamp restores what
 * this delete took and leaves photos the user had deleted individually — earlier,
 * on purpose — where they are.
 */
export async function restoreItems(ids: UUID[]): Promise<number> {
	if (!ids.length) return 0;
	const t = now();
	let restored = 0;
	await db.transaction('rw', [db.items, db.photos], async () => {
		for (const id of ids) {
			const item = await db.items.get(id);
			if (!item?.deletedAt) continue;
			const deletedAt = item.deletedAt;
			await db.photos
				.where('itemId')
				.equals(id)
				.modify((photo) => {
					if (photo.deletedAt !== deletedAt) return;
					photo.deletedAt = null;
					photo.updatedAt = t;
					photo.dirty = 1;
				});
			await db.items.update(id, { deletedAt: null, updatedAt: t, dirty: 1 });
			restored++;
		}
	});
	notifyItemsChanged(ids);
	return restored;
}

/** Tombstoned items still inside the retention window, newest deletion first. */
export async function listDeletedItems(): Promise<Item[]> {
	const items = await db.items.where('deletedAt').above('').toArray();
	return items.sort((a, b) => (b.deletedAt ?? '').localeCompare(a.deletedAt ?? ''));
}

export async function moveItem(id: UUID, collectionId: UUID): Promise<void> {
	await updateItem(id, { collectionId });
}

/** Move many items into another collection in one transaction. */
export async function moveItems(ids: UUID[], collectionId: UUID): Promise<void> {
	if (!ids.length) return;
	const t = now();
	await db.items.where('id').anyOf(ids).modify((item) => {
		item.collectionId = collectionId;
		item.updatedAt = t;
		item.dirty = 1;
	});
	notifyItemsChanged(ids);
}

/** Set the status on many items at once, mirroring markStatus' sold-date handling. */
export async function setItemsStatus(ids: UUID[], status: ItemStatus): Promise<void> {
	if (!ids.length) return;
	const t = now();
	const soldDate = t.slice(0, 10);
	await db.items.where('id').anyOf(ids).modify((item) => {
		if (status === 'sold') {
			// keep an existing sold date; only stamp one if the item lacks it
			item.soldDate = item.soldDate ?? soldDate;
		} else {
			item.soldPrice = null;
			item.soldDate = null;
		}
		item.status = status;
		item.updatedAt = t;
		item.dirty = 1;
	});
	notifyItemsChanged(ids);
}

/** Add a tag to many items, skipping any that already carry it. */
export async function addTagToItems(ids: UUID[], tag: string): Promise<void> {
	const clean = tag.trim();
	if (!ids.length || !clean) return;
	const t = now();
	const changed: UUID[] = [];
	await db.items.where('id').anyOf(ids).modify((item) => {
		if (item.tags.includes(clean)) return;
		item.tags = [...item.tags, clean];
		item.updatedAt = t;
		item.dirty = 1;
		changed.push(item.id);
	});
	if (changed.length) notifyItemsChanged(changed);
}

export async function bumpQuantity(id: UUID, delta = 1): Promise<void> {
	const item = await db.items.get(id);
	if (!item) return;
	await updateItem(id, { quantity: Math.max(1, item.quantity + delta) });
}

export async function markStatus(
	id: UUID,
	status: ItemStatus,
	extra: { soldPrice?: number | null; soldDate?: string | null } = {}
): Promise<void> {
	await updateItem(id, {
		status,
		soldPrice: extra.soldPrice ?? null,
		soldDate: status === 'sold' ? (extra.soldDate ?? now().slice(0, 10)) : null
	});
}

// ---------- photos ----------

export async function addPhoto(
	itemId: UUID,
	data: { blob: Blob; thumb: Blob; width: number; height: number; isPrimary?: boolean }
): Promise<ItemPhoto> {
	const t = now();
	const existing = await db.photos
		.where('itemId')
		.equals(itemId)
		.filter((p) => !p.deletedAt)
		.count();
	const photo: ItemPhoto = {
		id: newId(),
		itemId,
		blob: data.blob,
		thumb: data.thumb,
		storagePath: null,
		uploaded: 0,
		isPrimary: data.isPrimary ?? existing === 0,
		width: data.width,
		height: data.height,
		createdAt: t,
		updatedAt: t,
		deletedAt: null,
		dirty: 1
	};
	await db.photos.add(photo);
	notifyItemsChanged([itemId]);
	return photo;
}

export async function deletePhoto(id: UUID): Promise<void> {
	const t = now();
	const photo = await db.photos.get(id);
	if (!photo) return;
	await db.photos.update(id, { deletedAt: t, updatedAt: t, dirty: 1 });
	if (photo.isPrimary) {
		const next = await db.photos
			.where('itemId')
			.equals(photo.itemId)
			.filter((p) => !p.deletedAt)
			.first();
		if (next) await db.photos.update(next.id, { isPrimary: true, updatedAt: t, dirty: 1 });
	}
	notifyItemsChanged([photo.itemId]);
}

export async function primaryPhoto(itemId: UUID): Promise<ItemPhoto | undefined> {
	const photos = await db.photos
		.where('itemId')
		.equals(itemId)
		.filter((p) => !p.deletedAt)
		.toArray();
	return photos.find((p) => p.isPrimary) ?? photos[0];
}

// ---------- maintenance ----------

/**
 * Hard-delete tombstones that are old and already pushed (dirty=0).
 *
 * `orphanGraceDays` is separate from `olderThanDays` because "empty the trash
 * now" passes 0 for the latter: a photo row is the only record of its storage
 * object's path, so tying the two together would make emptying the trash orphan
 * every not-yet-removed object in the bucket forever.
 */
export async function purgeTombstones(
	olderThanDays = 30,
	orphanGraceDays = 2 * olderThanDays
): Promise<number> {
	// Measured on the write clock, not the wall clock: emptying the trash passes 0
	// days, and a row deleted moments ago carries a timestamp the wall clock has
	// not reached yet, so a `Date.now()` cutoff would leave it behind.
	const t = nowMs();
	const cutoff = new Date(t - olderThanDays * 86_400_000).toISOString();
	// A photo row is only purged once removeDeletedPhotoObjects has cleared its
	// object (which it signals by resetting uploaded to 0). The orphan cutoff is a
	// backstop for objects the server never lets us delete.
	const orphanCutoff = new Date(t - orphanGraceDays * 86_400_000).toISOString();
	let purged = 0;
	await db.transaction('rw', [db.collections, db.items, db.photos], async () => {
		for (const table of [db.collections, db.items] as const) {
			purged += await table
				.filter((row) => !!row.deletedAt && row.deletedAt < cutoff && row.dirty === 0)
				.delete();
		}
		purged += await db.photos
			.filter(
				(row) =>
					!!row.deletedAt &&
					row.deletedAt < cutoff &&
					row.dirty === 0 &&
					(row.uploaded === 0 || !row.storagePath || row.deletedAt < orphanCutoff)
			)
			.delete();
	});
	return purged;
}
