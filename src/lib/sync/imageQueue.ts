import { db } from '$lib/db/schema';
import { now } from '$lib/db/repo';
import { hasRoomToHydrate, withQuotaGuard } from '$lib/db/quota.svelte';
import type { ItemPhoto } from '$lib/db/types';
import { supabase } from './supabase';
import { activeFailureKeys, clearFailure, failureKey, recordFailure } from './failures';

/** One run uploads at most this many, so a large backlog can't monopolise a sync. */
const UPLOAD_BATCH = 20;

/**
 * How long a tombstoned photo keeps its cloud object. Matches the local
 * tombstone retention in purgeTombstones, so a photo restored inside the
 * retention window still has its image.
 */
const TOMBSTONE_GRACE_DAYS = 30;

const UPLOAD_TABLE = 'photo-upload';
const DOWNLOAD_TABLE = 'photo-download';

/** Upload every local photo blob that hasn't reached Supabase Storage yet. */
export async function uploadPendingPhotos(userId: string): Promise<void> {
	if (!supabase) return;
	const blocked = await activeFailureKeys(new Date().toISOString());
	const pending = await db.photos
		.where('uploaded')
		.equals(0)
		.filter((p) => !p.deletedAt && !!p.blob && !blocked.has(failureKey(UPLOAD_TABLE, p.id)))
		.limit(UPLOAD_BATCH)
		.toArray();

	for (const photo of pending) {
		const path = photo.storagePath ?? `${userId}/${photo.id}.webp`;
		const { error } = await supabase.storage
			.from('item-photos')
			.upload(path, photo.blob!, { contentType: photo.blob!.type || 'image/webp', upsert: true });
		if (error) {
			// back off instead of re-attempting a permanently broken object every sync
			await recordFailure(UPLOAD_TABLE, photo.id, photo.updatedAt, { message: error.message });
			continue;
		}
		await clearFailure(UPLOAD_TABLE, photo.id);
		// storagePath must reach other devices → stamp dirty so the next push carries it
		await db.photos.update(photo.id, {
			storagePath: path,
			uploaded: 1,
			updatedAt: now(),
			dirty: 1
		});
	}
}

/**
 * Best-effort removal of storage objects for tombstoned photos.
 *
 * Only touches rows whose tombstone has actually been pushed (`dirty === 0`) and
 * whose grace period has expired. Removing the object while the tombstone was
 * still local left other devices holding a row with a live storage_path pointing
 * at nothing, so their hydration 404'd on every sync forever.
 *
 * Must therefore run AFTER push(), or the dirty check means nothing.
 */
export async function removeDeletedPhotoObjects(): Promise<void> {
	if (!supabase) return;
	const cutoff = new Date(Date.now() - TOMBSTONE_GRACE_DAYS * 86_400_000).toISOString();
	const dead = await db.photos
		.where('deletedAt')
		.above('')
		.filter((p) => p.dirty === 0 && p.deletedAt! < cutoff && !!p.storagePath && p.uploaded === 1)
		.limit(UPLOAD_BATCH)
		.toArray();
	if (!dead.length) return;
	const { error } = await supabase.storage
		.from('item-photos')
		.remove(dead.map((p) => p.storagePath!));
	if (!error) {
		for (const photo of dead) await db.photos.update(photo.id, { uploaded: 0 });
	}
}

/**
 * Download blobs for photo rows that arrived via sync without local image
 * data, and regenerate their thumbnails. Bounded per run.
 */
export async function hydrateMissingPhotos(limit = 30): Promise<number> {
	if (!supabase) return 0;
	// filling the last of the device's storage with cloud copies would take the
	// whole origin down with it
	if (!(await hasRoomToHydrate())) return 0;
	const blocked = await activeFailureKeys(new Date().toISOString());
	const missing = await db.photos
		.where('storagePath')
		.above('')
		.filter((p) => !p.deletedAt && !p.thumb && !blocked.has(failureKey(DOWNLOAD_TABLE, p.id)))
		.limit(limit)
		.toArray();

	let hydrated = 0;
	for (const photo of missing) {
		hydrated += (await hydratePhoto(photo)) ? 1 : 0;
	}
	return hydrated;
}

export async function hydratePhoto(photo: ItemPhoto): Promise<boolean> {
	if (!supabase || !photo.storagePath) return false;
	const { data, error } = await supabase.storage.from('item-photos').download(photo.storagePath);
	if (error || !data) {
		await recordFailure(DOWNLOAD_TABLE, photo.id, photo.updatedAt, {
			message: error?.message ?? 'photo download failed'
		});
		return false;
	}
	try {
		const { processImage } = await import('$lib/scan/image');
		const processed = await processImage(data);
		// blob/thumb are local-only fields — no dirty stamp
		const written = await withQuotaGuard(() =>
			db.photos.update(photo.id, {
				blob: data,
				thumb: processed.thumb,
				uploaded: 1
			})
		);
		// out of space: leave the row unhydrated and try again when there's room
		if (written === null) return false;
		await clearFailure(DOWNLOAD_TABLE, photo.id);
		return true;
	} catch (err) {
		await recordFailure(DOWNLOAD_TABLE, photo.id, photo.updatedAt, {
			message: err instanceof Error ? err.message : String(err)
		});
		return false;
	}
}
