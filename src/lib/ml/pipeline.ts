import type { UUID } from '$lib/db/types';

/**
 * Background work after a photo is saved: OCR naming, embeddings, duplicate
 * hints. Stages are dynamic imports so Tesseract/TFJS never touch the initial
 * bundle. Never blocks the shutter — callers fire and forget.
 */
export async function runPostSavePipeline(itemId: UUID, photoId: UUID): Promise<void> {
	try {
		const { ocrStage } = await import('./ocrStage');
		await ocrStage(itemId, photoId);
	} catch (err) {
		console.warn('OCR stage failed', err);
	}
	try {
		const { embeddingStage } = await import('./embeddingStage');
		await embeddingStage(itemId, photoId);
	} catch (err) {
		console.warn('embedding stage failed', err);
	}
}
