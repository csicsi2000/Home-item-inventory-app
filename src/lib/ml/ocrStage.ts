import { db } from '$lib/db/schema';
import { updateItem } from '$lib/db/repo';
import type { UUID } from '$lib/db/types';
import { recognizePhoto, type OcrOutcome } from './ocr';
import { toast } from 'svelte-sonner';
import { base } from '$app/paths';
import { settings } from '$lib/state/settings.svelte';

/** Post-save stage: read the text on the new photo, store it, auto-name placeholders. */
export async function ocrStage(itemId: UUID, photoId: UUID): Promise<void> {
	if (!settings.autoOcr) return;
	const photo = await db.photos.get(photoId);
	const source = photo?.blob ?? photo?.thumb;
	if (!photo || photo.deletedAt || !source) return;

	const { text, suggestedName } = await recognizePhoto(source);
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
		outcomes.push(await recognizePhoto((photo.blob ?? photo.thumb)!));
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
