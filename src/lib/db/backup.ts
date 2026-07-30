import { db } from './schema';
import { notifyItemsChanged } from './repo';
import type { Collection, Item, ItemPhoto, ItemStatus } from './types';

/** Photo metadata as it appears in a backup — image blobs stay on-device / in the cloud. */
export type PhotoMeta = Omit<ItemPhoto, 'blob' | 'thumb'>;

export interface BackupPayload {
	exportedAt: string;
	collections: Collection[];
	items: Item[];
	photos: PhotoMeta[];
}

/** Collect everything worth backing up into a plain, JSON-serializable object. */
export async function buildBackup(): Promise<BackupPayload> {
	const [collections, items, photos] = await Promise.all([
		db.collections.filter((c) => !c.deletedAt).toArray(),
		db.items.filter((i) => !i.deletedAt).toArray(),
		db.photos.filter((p) => !p.deletedAt).toArray()
	]);
	return {
		exportedAt: new Date().toISOString(),
		collections,
		items,
		photos: photos.map(({ blob: _b, thumb: _t, ...meta }) => meta)
	};
}

export interface ImportResult {
	collections: { applied: number; skipped: number };
	items: { applied: number; skipped: number };
	photos: { applied: number; skipped: number };
}

class ImportError extends Error {}

function asArray<T>(value: unknown, label: string): T[] {
	if (value === undefined) return [];
	if (!Array.isArray(value)) throw new ImportError(`"${label}" must be a list`);
	return value as T[];
}

// ---------- per-record coercion ----------
//
// A backup file is user-supplied input: hand-edited, produced by an older build,
// or simply not ours. Records used to be written to Dexie verbatim, so a `tags`
// that arrived as a string (or absent) made every screen that does
// `item.tags.some(...)` throw — an unopenable collection from one bad import,
// with no way back short of clearing site data. Coerce each field to the shape
// the app guarantees, and drop records too broken to place.

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const nullableStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const nullableNum = (v: unknown): number | null =>
	typeof v === 'number' && Number.isFinite(v) ? v : null;
const strArray = (v: unknown): string[] =>
	Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function strRecord(v: unknown): Record<string, string> {
	if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
	return Object.fromEntries(
		Object.entries(v as Record<string, unknown>).filter(
			(entry): entry is [string, string] => typeof entry[1] === 'string'
		)
	);
}

/** Every record needs an id and a timestamp — last-write-wins can't place it otherwise. */
function identity(raw: unknown): { id: string; updatedAt: string } | null {
	if (!raw || typeof raw !== 'object') return null;
	const row = raw as Record<string, unknown>;
	if (typeof row.id !== 'string' || !row.id) return null;
	if (typeof row.updatedAt !== 'string' || !row.updatedAt) return null;
	return { id: row.id, updatedAt: row.updatedAt };
}

const STATUSES: ItemStatus[] = ['owned', 'sold', 'wishlist'];

export function coerceCollection(raw: unknown): Collection | null {
	const id = identity(raw);
	if (!id) return null;
	const row = raw as Record<string, unknown>;
	return {
		id: id.id,
		name: str(row.name),
		ownerId: nullableStr(row.ownerId),
		parentId: nullableStr(row.parentId),
		icon: nullableStr(row.icon),
		description: nullableStr(row.description),
		// `fields` and `display` drive rendering; anything unrecognizable becomes
		// the safe default rather than reaching a component
		fields: Array.isArray(row.fields) ? (row.fields as Collection['fields']) : [],
		display: row.display && typeof row.display === 'object' && !Array.isArray(row.display)
			? (row.display as Collection['display'])
			: null,
		createdAt: str(row.createdAt, id.updatedAt),
		updatedAt: id.updatedAt,
		deletedAt: nullableStr(row.deletedAt),
		dirty: 1
	};
}

export function coerceItem(raw: unknown): Item | null {
	const id = identity(raw);
	if (!id) return null;
	const row = raw as Record<string, unknown>;
	if (typeof row.collectionId !== 'string' || !row.collectionId) return null;
	const quantity = nullableNum(row.quantity);
	return {
		id: id.id,
		collectionId: row.collectionId,
		name: str(row.name),
		description: nullableStr(row.description),
		quantity: quantity !== null && quantity >= 1 ? Math.floor(quantity) : 1,
		status: STATUSES.includes(row.status as ItemStatus) ? (row.status as ItemStatus) : 'owned',
		condition: nullableStr(row.condition),
		tags: strArray(row.tags),
		barcode: nullableStr(row.barcode),
		ocrText: nullableStr(row.ocrText),
		acquisitionPrice: nullableNum(row.acquisitionPrice),
		acquisitionDate: nullableStr(row.acquisitionDate),
		soldPrice: nullableNum(row.soldPrice),
		soldDate: nullableStr(row.soldDate),
		currency: nullableStr(row.currency),
		customFields: strRecord(row.customFields),
		createdAt: str(row.createdAt, id.updatedAt),
		updatedAt: id.updatedAt,
		deletedAt: nullableStr(row.deletedAt),
		dirty: 1
	};
}

export function coercePhoto(raw: unknown): PhotoMeta | null {
	const id = identity(raw);
	if (!id) return null;
	const row = raw as Record<string, unknown>;
	if (typeof row.itemId !== 'string' || !row.itemId) return null;
	return {
		id: id.id,
		itemId: row.itemId,
		storagePath: nullableStr(row.storagePath),
		uploaded: row.uploaded === 1 ? 1 : 0,
		isPrimary: row.isPrimary === true,
		width: nullableNum(row.width) ?? 0,
		height: nullableNum(row.height) ?? 0,
		createdAt: str(row.createdAt, id.updatedAt),
		updatedAt: id.updatedAt,
		deletedAt: nullableStr(row.deletedAt),
		dirty: 1
	};
}

/** Parse + shape-check a file's text. Throws ImportError with a friendly message. */
export function parseBackup(text: string): BackupPayload {
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new ImportError("That file isn't valid JSON.");
	}
	if (!data || typeof data !== 'object') {
		throw new ImportError("That file doesn't look like a collections backup.");
	}
	const obj = data as Record<string, unknown>;
	const collections = asArray<Collection>(obj.collections, 'collections');
	const items = asArray<Item>(obj.items, 'items');
	const photos = asArray<PhotoMeta>(obj.photos, 'photos');
	if (!collections.length && !items.length) {
		throw new ImportError('The backup has no collections or items to import.');
	}
	return {
		exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : '',
		collections,
		items,
		photos
	};
}

/**
 * Merge a backup into the local database.
 *
 * Conflict resolution mirrors the sync engine's last-write-wins: an incoming record
 * only overwrites a local one when its `updatedAt` is strictly newer, so importing an
 * older backup never clobbers fresher data. Applied records are marked `dirty` so they
 * propagate to the cloud on the next sync. Photo image data (blob/thumb) is never in a
 * backup, so any local copy is preserved and cloud photos re-hydrate on the next sync.
 */
export async function importBackup(payload: BackupPayload): Promise<ImportResult> {
	const result: ImportResult = {
		collections: { applied: 0, skipped: 0 },
		items: { applied: 0, skipped: 0 },
		photos: { applied: 0, skipped: 0 }
	};
	const touchedItemIds = new Set<string>();

	await db.transaction('rw', [db.collections, db.items, db.photos], async () => {
		for (const raw of payload.collections) {
			const incoming = coerceCollection(raw);
			// unusable records are counted as skipped, not silently vanished
			if (!incoming) {
				result.collections.skipped++;
				continue;
			}
			const local = await db.collections.get(incoming.id);
			if (local && local.updatedAt >= incoming.updatedAt) {
				result.collections.skipped++;
				continue;
			}
			await db.collections.put(incoming);
			result.collections.applied++;
		}

		for (const raw of payload.items) {
			const incoming = coerceItem(raw);
			if (!incoming) {
				result.items.skipped++;
				continue;
			}
			const local = await db.items.get(incoming.id);
			if (local && local.updatedAt >= incoming.updatedAt) {
				result.items.skipped++;
				continue;
			}
			await db.items.put(incoming);
			result.items.applied++;
			touchedItemIds.add(incoming.id);
		}

		for (const raw of payload.photos) {
			const incoming = coercePhoto(raw);
			if (!incoming) {
				result.photos.skipped++;
				continue;
			}
			const local = await db.photos.get(incoming.id);
			if (local && local.updatedAt >= incoming.updatedAt) {
				result.photos.skipped++;
				continue;
			}
			await db.photos.put({
				...incoming,
				// image data never travels in a backup — keep whatever this device has
				blob: local?.blob ?? null,
				thumb: local?.thumb ?? null
			});
			result.photos.applied++;
			touchedItemIds.add(incoming.itemId);
		}
	});

	notifyItemsChanged([...touchedItemIds]);
	return result;
}

export { ImportError };
