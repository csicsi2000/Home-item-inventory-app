export type UUID = string;

/** Fields shared by every synced entity. */
export interface SyncMeta {
	/** ISO timestamp, client clock — used for last-write-wins conflict resolution. */
	updatedAt: string;
	/** Tombstone: set instead of hard-deleting so deletions sync to other devices. */
	deletedAt: string | null;
	/** 1 = has local changes that still need to be pushed (0/1 so Dexie can index it). */
	dirty: 0 | 1;
}

/** A field defined at the collection level and shown on every item in it. */
export interface CollectionField {
	id: UUID;
	label: string;
	type: 'text' | 'number';
}

export type CollectionViewMode = 'grid' | 'list';

export type SortKey = 'createdAt' | 'name' | 'price' | 'quantity';

/** How items are ordered in the collection view. */
export interface CollectionSort {
	key: SortKey;
	dir: 'asc' | 'desc';
}

/** Per-collection presentation settings (synced with the collection). */
export interface CollectionDisplay {
	view: CollectionViewMode;
	/**
	 * Short labels shown on each item in the collection view.
	 * Built-in keys ('price', 'tags', …) or `cf:<fieldId>` for collection fields.
	 */
	labels: string[];
	/** Item sort order. Absent → newest-first (the historical default). */
	sort?: CollectionSort;
}

export type ShareRole = 'read' | 'write' | 'owner';

/**
 * A share granted to me on someone else's collection, cached locally so
 * role checks work offline. Rebuilt from the server on every pull.
 */
export interface ShareGrant {
	collectionId: UUID;
	role: ShareRole;
	ownerId: UUID;
	ownerEmail: string | null;
}

/** A share I granted (or that targets me) as stored on the server. */
export interface RemoteShare {
	id: UUID;
	collectionId: UUID;
	ownerId: UUID;
	granteeEmail: string;
	role: ShareRole;
	createdAt: string;
}

export interface Collection extends SyncMeta {
	id: UUID;
	name: string;
	/**
	 * Supabase user id of the account that owns this collection. Filled in
	 * from sync; null/undefined → created locally, i.e. mine.
	 */
	ownerId?: UUID | null;
	/** Parent collection for folder-style nesting; null → top level. */
	parentId: UUID | null;
	/** Emoji or lucide icon name shown on the dashboard card. */
	icon: string | null;
	description: string | null;
	/** Field template applied to items in this collection (values live in item.customFields). */
	fields: CollectionField[];
	/** View mode + item labels for this collection. Null → defaults (grid, tags). */
	display: CollectionDisplay | null;
	createdAt: string;
}

export type ItemStatus = 'owned' | 'sold' | 'wishlist';

export interface Item extends SyncMeta {
	id: UUID;
	collectionId: UUID;
	name: string;
	description: string | null;
	quantity: number;
	status: ItemStatus;
	/** Free text: "mint", "used", "for parts", … */
	condition: string | null;
	tags: string[];
	/** EAN/UPC/QR payload from the barcode scanner. */
	barcode: string | null;
	/** Raw text recognized on the item by OCR — searchable, feeds duplicate detection. */
	ocrText: string | null;
	acquisitionPrice: number | null;
	acquisitionDate: string | null;
	soldPrice: number | null;
	soldDate: string | null;
	/** ISO 4217 code for this item's prices (bought/sold). Null → app default. */
	currency: string | null;
	customFields: Record<string, string>;
	createdAt: string;
}

export interface ItemPhoto extends SyncMeta {
	id: UUID;
	itemId: UUID;
	/** Full-res WebP (max edge 1600px). Null until downloaded from cloud on this device. */
	blob: Blob | null;
	/** ~300px WebP thumbnail; regenerated locally after a cloud download. */
	thumb: Blob | null;
	/** Supabase Storage object path (`{userId}/{photoId}.webp`) once uploaded. */
	storagePath: string | null;
	uploaded: 0 | 1;
	isPrimary: boolean;
	width: number;
	height: number;
	createdAt: string;
}

/** Derived, re-computable ML data for duplicate detection. */
export interface ItemEmbedding {
	itemId: UUID;
	/** 64-bit DCT perceptual hash as 16 hex chars. */
	phash: string;
	/** L2-normalized MobileNet feature vector. */
	vector: Float32Array;
	updatedAt: string;
	dirty: 0 | 1;
}

/** Per-table pull cursor for the sync engine. */
export interface SyncState {
	table: string;
	lastPulledAt: string;
}

export type DuplicateVerdict =
	| { kind: 'barcode'; item: Item }
	| { kind: 'phash'; item: Item; distance: number }
	| { kind: 'embedding'; item: Item; similarity: number }
	| { kind: 'ocr'; item: Item; overlap: number };
