import { db } from './schema';
import { notifyItemsChanged } from './repo';
import type { Collection, Item, ItemPhoto } from './types';

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
		for (const incoming of payload.collections) {
			if (!incoming?.id) continue;
			const local = await db.collections.get(incoming.id);
			if (local && local.updatedAt >= incoming.updatedAt) {
				result.collections.skipped++;
				continue;
			}
			await db.collections.put({ ...incoming, dirty: 1 });
			result.collections.applied++;
		}

		for (const incoming of payload.items) {
			if (!incoming?.id) continue;
			const local = await db.items.get(incoming.id);
			if (local && local.updatedAt >= incoming.updatedAt) {
				result.items.skipped++;
				continue;
			}
			await db.items.put({ ...incoming, dirty: 1 });
			result.items.applied++;
			touchedItemIds.add(incoming.id);
		}

		for (const incoming of payload.photos) {
			if (!incoming?.id) continue;
			const local = await db.photos.get(incoming.id);
			if (local && local.updatedAt >= incoming.updatedAt) {
				result.photos.skipped++;
				continue;
			}
			await db.photos.put({
				...incoming,
				// image data never travels in a backup — keep whatever this device has
				blob: local?.blob ?? null,
				thumb: local?.thumb ?? null,
				dirty: 1
			});
			result.photos.applied++;
			touchedItemIds.add(incoming.itemId);
		}
	});

	notifyItemsChanged([...touchedItemIds]);
	return result;
}

export { ImportError };
