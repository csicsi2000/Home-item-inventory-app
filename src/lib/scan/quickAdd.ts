import { addPhoto, createItem } from '$lib/db/repo';
import type { Item, ItemPhoto, UUID } from '$lib/db/types';
import { processImage, type ProcessedImage } from './image';
import { runPostSavePipeline } from '$lib/ml/pipeline';

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
	const item = await createItem({ collectionId, barcode: extra.barcode ?? null });
	const photo = await addPhoto(item.id, processed);
	void runPostSavePipeline(item.id, photo.id);
	return { item, photo, processed };
}
