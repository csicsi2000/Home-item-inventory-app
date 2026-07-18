import { addPhoto, createItem } from '$lib/db/repo';
import type { Item, ItemPhoto, UUID } from '$lib/db/types';
import { processImage, type ProcessedImage } from './image';
import { processQueue } from '$lib/ml/queue.svelte';
import { settings } from '$lib/state/settings.svelte';

export interface QuickAddResult {
	item: Item;
	photo: ItemPhoto;
	processed: ProcessedImage;
}

/**
 * The core capture loop: photo in → item saved immediately.
 * OCR naming / embeddings / duplicate hints run afterwards in the background.
 */
export async function quickAddFromImage(
	collectionId: UUID,
	source: Blob | HTMLCanvasElement,
	extra: { barcode?: string | null } = {}
): Promise<QuickAddResult> {
	const processed = await processImage(source);
	const item = await createItem({
		collectionId,
		barcode: extra.barcode ?? null,
		currency: settings.defaultCurrency
	});
	const photo = await addPhoto(item.id, processed);
	// heavy recognition is serialized off the shutter so rapid scanning can't
	// spin up several model instances at once and crash the tab
	processQueue.enqueue(item.id, photo.id);
	return { item, photo, processed };
}
