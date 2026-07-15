import { db } from '$lib/db/schema';
import { onItemsChanged, purgeTombstones } from '$lib/db/repo';
import type { Collection, Item, ItemPhoto } from '$lib/db/types';
import { supabase, syncConfigured } from './supabase';
import { auth } from './auth.svelte';
import { hydrateMissingPhotos, removeDeletedPhotoObjects, uploadPendingPhotos } from './imageQueue';

type RemoteRow = Record<string, unknown>;

const PUSH_CHUNK = 400;
const PULL_PAGE = 1000;
const EPOCH = '1970-01-01T00:00:00Z';

const iso = (value: unknown): string => new Date(String(value)).toISOString();
const isoOrNull = (value: unknown): string | null => (value ? iso(value) : null);

class SyncStatus {
	state = $state<'disabled' | 'signed-out' | 'idle' | 'syncing' | 'error' | 'offline'>(
		syncConfigured ? 'signed-out' : 'disabled'
	);
	lastSyncAt = $state<string | null>(null);
	error = $state<string | null>(null);
	pendingChanges = $state(0);
}

export const syncStatus = new SyncStatus();

// ---------- table mappings ----------

interface TableSync {
	remote: string;
	dirtyRows(): Promise<{ id: string; updatedAt: string; row: RemoteRow }[]>;
	clearDirty(id: string, pushedUpdatedAt: string): Promise<void>;
	applyRemote(row: RemoteRow): Promise<void>;
}

async function applyWithLww<T extends { updatedAt: string; dirty: 0 | 1 }>(
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

const collectionsSync: TableSync = {
	remote: 'collections',
	async dirtyRows() {
		const rows = await db.collections.where('dirty').equals(1).toArray();
		return rows.map((c) => ({
			id: c.id,
			updatedAt: c.updatedAt,
			row: {
				id: c.id,
				name: c.name,
				icon: c.icon,
				description: c.description,
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
			name: String(row.name ?? ''),
			icon: (row.icon as string | null) ?? null,
			description: (row.description as string | null) ?? null,
			createdAt: iso(row.created_at),
			updatedAt,
			deletedAt: isoOrNull(row.deleted_at),
			dirty: 0
		}));
	}
};

const itemsSync: TableSync = {
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
			acquisitionPrice: row.acquisition_price === null ? null : Number(row.acquisition_price),
			acquisitionDate: (row.acquisition_date as string | null) ?? null,
			soldPrice: row.sold_price === null ? null : Number(row.sold_price),
			soldDate: (row.sold_date as string | null) ?? null,
			customFields: (row.custom_fields as Record<string, string> | null) ?? {},
			createdAt: iso(row.created_at),
			updatedAt,
			deletedAt: isoOrNull(row.deleted_at),
			dirty: 0
		}));
	}
};

const photosSync: TableSync = {
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

const TABLES: TableSync[] = [collectionsSync, itemsSync, photosSync];

// ---------- push / pull ----------

async function push(): Promise<void> {
	for (const table of TABLES) {
		const dirty = await table.dirtyRows();
		for (let offset = 0; offset < dirty.length; offset += PUSH_CHUNK) {
			const chunk = dirty.slice(offset, offset + PUSH_CHUNK);
			const { error } = await supabase!
				.from(table.remote)
				.upsert(chunk.map((c) => c.row), { onConflict: 'id' });
			if (error) throw new Error(`push ${table.remote}: ${error.message}`);
			for (const entry of chunk) await table.clearDirty(entry.id, entry.updatedAt);
		}
	}
}

async function pull(): Promise<void> {
	for (const table of TABLES) {
		let cursor = (await db.syncState.get(table.remote))?.lastPulledAt ?? EPOCH;
		for (;;) {
			const { data, error } = await supabase!
				.from(table.remote)
				.select('*')
				.gt('server_updated_at', cursor)
				.order('server_updated_at', { ascending: true })
				.limit(PULL_PAGE);
			if (error) throw new Error(`pull ${table.remote}: ${error.message}`);
			if (!data?.length) break;
			for (const row of data) await table.applyRemote(row as RemoteRow);
			cursor = String((data[data.length - 1] as RemoteRow).server_updated_at);
			await db.syncState.put({ table: table.remote, lastPulledAt: cursor });
			if (data.length < PULL_PAGE) break;
		}
	}
}

async function countPending(): Promise<number> {
	let total = 0;
	for (const table of [db.collections, db.items, db.photos] as const) {
		total += await table.where('dirty').equals(1).count();
	}
	return total;
}

// ---------- orchestration ----------

let syncing = false;
let queued = false;

export async function syncNow(): Promise<void> {
	if (!supabase || !auth.session) return;
	if (syncing) {
		queued = true;
		return;
	}
	syncing = true;
	syncStatus.state = 'syncing';
	syncStatus.error = null;
	try {
		await uploadPendingPhotos(auth.session.user.id);
		await removeDeletedPhotoObjects();
		await push();
		await pull();
		const hydrated = await hydrateMissingPhotos();
		if (hydrated > 0) {
			// newly arrived photos may need fingerprints for duplicate detection
			void import('$lib/ml/embeddingStage').then((m) => m.scheduleBackfill?.());
		}
		await purgeTombstones();
		syncStatus.state = 'idle';
		syncStatus.lastSyncAt = new Date().toISOString();
	} catch (err) {
		console.warn('sync failed', err);
		syncStatus.state = navigator.onLine ? 'error' : 'offline';
		syncStatus.error = err instanceof Error ? err.message : String(err);
	} finally {
		syncStatus.pendingChanges = await countPending().catch(() => 0);
		syncing = false;
		if (queued) {
			queued = false;
			void syncNow();
		}
	}
}

let started = false;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

export function startSyncEngine(): void {
	if (started || !syncConfigured || typeof window === 'undefined') return;
	started = true;

	// keep the pending-changes badge fresh + push soon after local writes
	onItemsChanged(() => {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => void syncNow(), 5000);
		void countPending().then((n) => (syncStatus.pendingChanges = n));
	});

	window.addEventListener('online', () => void syncNow());
	setInterval(() => {
		if (!document.hidden) void syncNow();
	}, 5 * 60_000);

	void countPending().then((n) => (syncStatus.pendingChanges = n));

	// first sync as soon as we know who's signed in
	$effect.root(() => {
		$effect(() => {
			if (auth.session) {
				syncStatus.state = 'syncing';
				void syncNow();
			} else if (auth.ready) {
				syncStatus.state = 'signed-out';
			}
		});
	});
}
