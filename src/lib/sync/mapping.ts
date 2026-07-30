import { db } from '$lib/db/schema';
import type { Collection, Item, ItemPhoto } from '$lib/db/types';

export type RemoteRow = Record<string, unknown>;

export const iso = (value: unknown): string => new Date(String(value)).toISOString();
export const isoOrNull = (value: unknown): string | null => (value ? iso(value) : null);

/** PostgREST returns `numeric` columns as strings. */
const num = (value: unknown): number | null =>
	value === null || value === undefined ? null : Number(value);

export interface DirtyRow {
	id: string;
	updatedAt: string;
	row: RemoteRow;
}

export interface TableSync {
	remote: string;
	dirtyRows(): Promise<DirtyRow[]>;
	clearDirty(id: string, pushedUpdatedAt: string): Promise<void>;
	applyRemote(row: RemoteRow): Promise<void>;
}

export async function applyWithLww<T extends { updatedAt: string; dirty: 0 | 1 }>(
	table: { get(id: string): Promise<T | undefined>; put(row: T): Promise<unknown> },
	id: string,
	remoteUpdatedAt: string,
	merge: (local: T | undefined) => T
): Promise<void> {
	const local = await table.get(id);
	// keep local edits that are newer and still unpushed
	if (local && local.dirty === 1 && local.updatedAt >= remoteUpdatedAt) return;
	await table.put(merge(local));
}

/**
 * Parents before children: the whole batch lands in one upsert statement,
 * and the RLS insert check on a subcollection looks up its parent row.
 */
export function sortParentsFirst(rows: Collection[]): Collection[] {
	const pending = new Map(rows.map((c) => [c.id, c]));
	const ordered: Collection[] = [];
	const visit = (c: Collection) => {
		if (!pending.delete(c.id)) return;
		const parent = c.parentId ? pending.get(c.parentId) : undefined;
		if (parent) visit(parent);
		ordered.push(c);
	};
	for (const c of rows) visit(c);
	return ordered;
}

export const collectionsSync: TableSync = {
	remote: 'collections',
	async dirtyRows() {
		const rows = sortParentsFirst(await db.collections.where('dirty').equals(1).toArray());
		return rows.map((c) => ({
			id: c.id,
			updatedAt: c.updatedAt,
			row: {
				id: c.id,
				name: c.name,
				parent_id: c.parentId ?? null,
				icon: c.icon,
				description: c.description,
				fields: c.fields ?? [],
				display: c.display ?? null,
				created_at: c.createdAt,
				updated_at: c.updatedAt,
				deleted_at: c.deletedAt
			}
		}));
	},
	async clearDirty(id, pushed) {
		await db.collections
			.where('id')
			.equals(id)
			.modify((c) => {
				if (c.updatedAt === pushed) c.dirty = 0;
			});
	},
	async applyRemote(row) {
		const updatedAt = iso(row.updated_at);
		await applyWithLww<Collection>(db.collections, String(row.id), updatedAt, () => ({
			id: String(row.id),
			ownerId: (row.user_id as string | null) ?? null,
			name: String(row.name ?? ''),
			parentId: (row.parent_id as string | null) ?? null,
			icon: (row.icon as string | null) ?? null,
			description: (row.description as string | null) ?? null,
			fields: (row.fields as Collection['fields'] | null) ?? [],
			display: (row.display as Collection['display'] | null) ?? null,
			createdAt: iso(row.created_at),
			updatedAt,
			deletedAt: isoOrNull(row.deleted_at),
			dirty: 0
		}));
	}
};

export const itemsSync: TableSync = {
	remote: 'items',
	async dirtyRows() {
		const rows = await db.items.where('dirty').equals(1).toArray();
		return rows.map((i) => ({
			id: i.id,
			updatedAt: i.updatedAt,
			row: {
				id: i.id,
				collection_id: i.collectionId,
				name: i.name,
				description: i.description,
				quantity: i.quantity,
				status: i.status,
				condition: i.condition,
				tags: i.tags,
				barcode: i.barcode,
				ocr_text: i.ocrText,
				acquisition_price: i.acquisitionPrice,
				acquisition_date: i.acquisitionDate,
				sold_price: i.soldPrice,
				sold_date: i.soldDate,
				currency: i.currency,
				custom_fields: i.customFields,
				created_at: i.createdAt,
				updated_at: i.updatedAt,
				deleted_at: i.deletedAt
			}
		}));
	},
	async clearDirty(id, pushed) {
		await db.items
			.where('id')
			.equals(id)
			.modify((i) => {
				if (i.updatedAt === pushed) i.dirty = 0;
			});
	},
	async applyRemote(row) {
		const updatedAt = iso(row.updated_at);
		await applyWithLww<Item>(db.items, String(row.id), updatedAt, () => ({
			id: String(row.id),
			collectionId: String(row.collection_id),
			name: String(row.name ?? ''),
			description: (row.description as string | null) ?? null,
			quantity: Number(row.quantity ?? 1),
			status: (row.status as Item['status']) ?? 'owned',
			condition: (row.condition as string | null) ?? null,
			tags: (row.tags as string[] | null) ?? [],
			barcode: (row.barcode as string | null) ?? null,
			ocrText: (row.ocr_text as string | null) ?? null,
			acquisitionPrice: num(row.acquisition_price),
			acquisitionDate: (row.acquisition_date as string | null) ?? null,
			soldPrice: num(row.sold_price),
			soldDate: (row.sold_date as string | null) ?? null,
			currency: (row.currency as string | null) ?? null,
			customFields: (row.custom_fields as Record<string, string> | null) ?? {},
			createdAt: iso(row.created_at),
			updatedAt,
			deletedAt: isoOrNull(row.deleted_at),
			dirty: 0
		}));
	}
};

export const photosSync: TableSync = {
	remote: 'item_photos',
	async dirtyRows() {
		const rows = await db.photos.where('dirty').equals(1).toArray();
		return rows.map((p) => ({
			id: p.id,
			updatedAt: p.updatedAt,
			row: {
				id: p.id,
				item_id: p.itemId,
				storage_path: p.storagePath,
				is_primary: p.isPrimary,
				width: p.width,
				height: p.height,
				created_at: p.createdAt,
				updated_at: p.updatedAt,
				deleted_at: p.deletedAt
			}
		}));
	},
	async clearDirty(id, pushed) {
		await db.photos
			.where('id')
			.equals(id)
			.modify((p) => {
				if (p.updatedAt === pushed) p.dirty = 0;
			});
	},
	async applyRemote(row) {
		const updatedAt = iso(row.updated_at);
		await applyWithLww<ItemPhoto>(db.photos, String(row.id), updatedAt, (local) => ({
			id: String(row.id),
			itemId: String(row.item_id),
			// image data is local-only — keep whatever this device already has
			blob: local?.blob ?? null,
			thumb: local?.thumb ?? null,
			storagePath: (row.storage_path as string | null) ?? local?.storagePath ?? null,
			uploaded: row.storage_path ? 1 : (local?.uploaded ?? 0),
			isPrimary: Boolean(row.is_primary),
			width: Number(row.width ?? local?.width ?? 0),
			height: Number(row.height ?? local?.height ?? 0),
			createdAt: iso(row.created_at),
			updatedAt,
			deletedAt: isoOrNull(row.deleted_at),
			dirty: 0
		}));
	}
};

export const TABLES: TableSync[] = [collectionsSync, itemsSync, photosSync];

/**
 * The exact column set each table pushes. Asserted in mapping.spec.ts so that
 * adding a push column without the matching pull mapping fails a test instead of
 * silently dropping the value on every other device (AGENTS.md, "changing a
 * synced field", step 3).
 */
export const PUSH_COLUMNS: Record<string, string[]> = {
	collections: [
		'created_at',
		'deleted_at',
		'description',
		'display',
		'fields',
		'icon',
		'id',
		'name',
		'parent_id',
		'updated_at'
	],
	items: [
		'acquisition_date',
		'acquisition_price',
		'barcode',
		'collection_id',
		'condition',
		'created_at',
		'currency',
		'custom_fields',
		'deleted_at',
		'description',
		'id',
		'name',
		'ocr_text',
		'quantity',
		'sold_date',
		'sold_price',
		'status',
		'tags',
		'updated_at'
	],
	item_photos: [
		'created_at',
		'deleted_at',
		'height',
		'id',
		'is_primary',
		'item_id',
		'storage_path',
		'updated_at',
		'width'
	]
};
