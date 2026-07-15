import { db } from './schema';
import type { Collection, Item, ItemPhoto, ItemStatus, UUID } from './types';

export const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();

/** Fired after any write that changes items — the search index subscribes to this. */
type ItemsChangedListener = (itemIds: UUID[]) => void;
const itemListeners = new Set<ItemsChangedListener>();
export function onItemsChanged(fn: ItemsChangedListener): () => void {
	itemListeners.add(fn);
	return () => itemListeners.delete(fn);
}
function notifyItemsChanged(ids: UUID[]) {
	for (const fn of itemListeners) fn(ids);
}

// ---------- collections ----------

export async function createCollection(
	data: Pick<Collection, 'name'> & Partial<Pick<Collection, 'icon' | 'description'>>
): Promise<Collection> {
	const t = now();
	const collection: Collection = {
		id: newId(),
		name: data.name,
		icon: data.icon ?? null,
		description: data.description ?? null,
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
	patch: Partial<Pick<Collection, 'name' | 'icon' | 'description'>>
): Promise<void> {
	await db.collections.update(id, { ...patch, updatedAt: now(), dirty: 1 });
	notifyItemsChanged([]);
}

/** Tombstones the collection and everything inside it. */
export async function deleteCollection(id: UUID): Promise<void> {
	const t = now();
	await db.transaction('rw', [db.collections, db.items, db.photos, db.embeddings], async () => {
		const items = await db.items.where('collectionId').equals(id).toArray();
		const itemIds = items.filter((i) => !i.deletedAt).map((i) => i.id);
		for (const itemId of itemIds) await tombstoneItem(itemId, t);
		await db.collections.update(id, { deletedAt: t, updatedAt: t, dirty: 1 });
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
	await db.photos.where('itemId').equals(id).modify({ deletedAt: t, updatedAt: t, dirty: 1 });
	await db.embeddings.where('itemId').equals(id).delete();
}

export async function deleteItem(id: UUID): Promise<void> {
	await db.transaction('rw', [db.items, db.photos, db.embeddings], () =>
		tombstoneItem(id, now())
	);
	notifyItemsChanged([id]);
}

export async function moveItem(id: UUID, collectionId: UUID): Promise<void> {
	await updateItem(id, { collectionId });
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

/** Hard-delete tombstones that are old and already pushed (dirty=0). */
export async function purgeTombstones(olderThanDays = 30): Promise<number> {
	const cutoff = new Date(Date.now() - olderThanDays * 86_400_000).toISOString();
	let purged = 0;
	await db.transaction('rw', [db.collections, db.items, db.photos], async () => {
		for (const table of [db.collections, db.items, db.photos] as const) {
			purged += await table
				.filter(
					(row) => !!row.deletedAt && row.deletedAt < cutoff && row.dirty === 0
				)
				.delete();
		}
	});
	return purged;
}
