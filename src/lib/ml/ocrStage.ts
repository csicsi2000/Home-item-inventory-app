import { db } from '$lib/db/schema';
import { updateItem } from '$lib/db/repo';
import type { UUID } from '$lib/db/types';
import { type OcrOutcome } from './ocr';
import { analyzePhoto } from './analyze';
import { toast } from 'svelte-sonner';
import { base } from '$app/paths';
import { settings } from '$lib/state/settings.svelte';

/** Post-save stage: read the text on the new photo, store it, auto-name placeholders. */
export async function ocrStage(itemId: UUID, photoId: UUID): Promise<void> {
	if (!settings.autoOcr) return;
	const photo = await db.photos.get(photoId);
	const source = photo?.blob ?? photo?.thumb;
	if (!photo || photo.deletedAt || !source) return;

	const { text, suggestedName } = await analyzePhoto(source);
	if (!text) return;

	const item = await db.items.get(itemId);
	if (!item || item.deletedAt) return;

	const ocrText = item.ocrText ? `${item.ocrText}\n${text}` : text;
	const patch: Parameters<typeof updateItem>[1] = { ocrText };

	if (!item.name.trim() && suggestedName) {
		patch.name = suggestedName;
		toast.success(`Named “${suggestedName}” from the photo text`, {
			action: {
				label: 'Edit',
				onClick: () => {
					location.href = `${base}/items/${itemId}`;
				}
			}
		});
	}
	await updateItem(itemId, patch);
}

/** Re-run OCR over every photo of an item (the "re-scan text" button). */
export async function ocrItem(itemId: UUID): Promise<OcrOutcome | null> {
	const photos = await db.photos
		.where('itemId')
		.equals(itemId)
		.filter((p) => !p.deletedAt && !!(p.blob ?? p.thumb))
		.toArray();
	if (!photos.length) return null;

	const outcomes: OcrOutcome[] = [];
	for (const photo of photos) {
		outcomes.push(await analyzePhoto((photo.blob ?? photo.thumb)!));
	}
	const text = outcomes.map((o) => o.text).filter(Boolean).join('\n');
	// merge candidates across photos, keeping ranking order and de-duping
	const candidates: string[] = [];
	for (const o of outcomes) {
		for (const c of o.candidates) {
			if (!candidates.some((x) => x.toLowerCase() === c.toLowerCase())) candidates.push(c);
		}
	}
	const suggestedName = candidates[0] ?? null;

	await updateItem(itemId, { ocrText: text || null });
	return { text, suggestedName, candidates };
}

/**
 * Re-run OCR over every item that has a photo — used to retroactively improve
 * entries after the recognition pipeline changes. Refreshes ocrText for all,
 * and auto-names only items that are still unnamed (never overwrites a name
 * the user set).
 */
export async function reprocessAllItems(
	onProgress?: (done: number, total: number) => void
): Promise<{ processed: number; named: number }> {
	const items = await db.items.filter((i) => !i.deletedAt).toArray();
	const targets: typeof items = [];
	for (const item of items) {
		const hasPhoto = await db.photos
			.where('itemId')
			.equals(item.id)
			.filter((p) => !p.deletedAt && !!(p.blob ?? p.thumb))
			.count();
		if (hasPhoto) targets.push(item);
	}

	let processed = 0;
	let named = 0;
	for (const item of targets) {
		try {
			const outcome = await ocrItem(item.id);
			if (outcome && !item.name.trim() && outcome.suggestedName) {
				await updateItem(item.id, { name: outcome.suggestedName });
				named++;
			}
		} catch (err) {
			console.warn('reprocess failed for', item.id, err);
		}
		processed++;
		onProgress?.(processed, targets.length);
	}
	return { processed, named };
}
