import { db } from '$lib/db/schema';
import { now } from '$lib/db/repo';
import type { ItemPhoto } from '$lib/db/types';
import { supabase } from './supabase';

/** Upload every local photo blob that hasn't reached Supabase Storage yet. */
export async function uploadPendingPhotos(userId: string): Promise<void> {
	if (!supabase) return;
	const pending = await db.photos
		.where('uploaded')
		.equals(0)
		.filter((p) => !p.deletedAt && !!p.blob)
		.toArray();

	for (const photo of pending) {
		const path = photo.storagePath ?? `${userId}/${photo.id}.webp`;
		const { error } = await supabase.storage
			.from('item-photos')
			.upload(path, photo.blob!, { contentType: photo.blob!.type || 'image/webp', upsert: true });
		if (error) {
			console.warn('photo upload failed', photo.id, error.message);
			continue;
		}
		// storagePath must reach other devices → stamp dirty so the next push carries it
		await db.photos.update(photo.id, {
			storagePath: path,
			uploaded: 1,
			updatedAt: now(),
			dirty: 1
		});
	}
}

/** Best-effort removal of storage objects for tombstoned photos. */
export async function removeDeletedPhotoObjects(): Promise<void> {
	if (!supabase) return;
	const dead = await db.photos
		.filter((p) => !!p.deletedAt && !!p.storagePath && p.uploaded === 1)
		.toArray();
	if (!dead.length) return;
	const paths = dead.map((p) => p.storagePath!) as string[];
	const { error } = await supabase.storage.from('item-photos').remove(paths);
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
	const missing = await db.photos
		.filter((p) => !p.deletedAt && !p.thumb && !!p.storagePath)
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
		console.warn('photo download failed', photo.id, error?.message);
		return false;
	}
	try {
		const { processImage } = await import('$lib/scan/image');
		const processed = await processImage(data);
		// blob/thumb are local-only fields — no dirty stamp
		await db.photos.update(photo.id, {
			blob: data,
			thumb: processed.thumb,
			uploaded: 1
		});
		return true;
	} catch (err) {
		console.warn('photo hydrate failed', photo.id, err);
		return false;
	}
}
