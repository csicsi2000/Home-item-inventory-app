import { db } from '$lib/db/schema';
import { now } from '$lib/db/repo';
import type { UUID } from '$lib/db/types';
import { settings } from '$lib/state/settings.svelte';
import { dupAlert } from '$lib/state/dupAlert.svelte';
import { toast } from 'svelte-sonner';

/** Compute + store the item's visual fingerprint from a photo blob. */
async function fingerprint(itemId: UUID, source: Blob): Promise<void> {
	const [{ phash }, { embed }] = await Promise.all([import('./phash'), import('./embeddings')]);
	const [hash, vector] = await Promise.all([phash(source), embed(source)]);
	await db.embeddings.put({ itemId, phash: hash, vector, updatedAt: now(), dirty: 1 });
}

/**
 * Post-save stage: fingerprint the item's photo, then look for duplicates in
 * the same collection. Strong matches raise the blocking DuplicateAlert sheet;
 * weaker ones surface as a toast hint.
 */
export async function embeddingStage(itemId: UUID, photoId: UUID): Promise<void> {
	if (!settings.autoDuplicateCheck) return;
	const photo = await db.photos.get(photoId);
	const source = photo?.blob ?? photo?.thumb;
	if (!photo || photo.deletedAt || !source) return;

	// one fingerprint per item, from its primary photo
	const existing = await db.embeddings.get(itemId);
	if (existing && !photo.isPrimary) return;

	await fingerprint(itemId, source);

	const item = await db.items.get(itemId);
	if (!item || item.deletedAt) return;

	const { findDuplicates } = await import('./duplicates');
	const { block, hints } = await findDuplicates(itemId);

	if (block) {
		dupAlert.pending = { newItem: item, match: block };
	} else if (hints.length) {
		const names = hints.map((h) => h.item.name || 'an unnamed item').join(', ');
		toast.info(`Similar items already in this collection: ${names}`);
	}

	scheduleBackfill();
}

let backfillTimer: ReturnType<typeof setTimeout> | undefined;

/** Fingerprint items that predate the model being loaded (or synced from elsewhere). */
export function scheduleBackfill() {
	clearTimeout(backfillTimer);
	backfillTimer = setTimeout(async () => {
		try {
			const have = new Set<string>();
			await db.embeddings.each((e) => {
				have.add(e.itemId);
			});
			const missing = await db.items
				.filter((i) => !i.deletedAt && !have.has(i.id))
				.limit(50)
				.toArray();
			for (const item of missing) {
				const photos = await db.photos
					.where('itemId')
					.equals(item.id)
					.filter((p) => !p.deletedAt && !!(p.blob ?? p.thumb))
					.toArray();
				const photo = photos.find((p) => p.isPrimary) ?? photos[0];
				const source = photo?.blob ?? photo?.thumb;
				if (source) await fingerprint(item.id, source);
			}
		} catch (err) {
			console.warn('embedding backfill failed', err);
		}
	}, 4000);
}
