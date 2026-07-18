import type { UUID } from '$lib/db/types';

/**
 * Background work after a photo is saved: OCR naming, embeddings, duplicate
 * hints. Stages are dynamic imports so Tesseract/TFJS never touch the initial
 * bundle. Never blocks the shutter — callers fire and forget.
 */
export async function runPostSavePipeline(itemId: UUID, photoId: UUID): Promise<void> {
	// Barcode lookup first — product databases are authoritative for a name, so
	// let it win over OCR when the item carries a barcode (no-op unless enabled).
	try {
		const { barcodeStage } = await import('./barcodeStage');
		await barcodeStage(itemId);
	} catch (err) {
		console.warn('barcode stage failed', err);
	}
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
