import type { MlStage, UUID } from '$lib/db/types';

export const ALL_STAGES: MlStage[] = ['barcode', 'ocr', 'embedding'];

export interface PipelineResult {
	completed: MlStage[];
	failed: { stage: MlStage; error: unknown }[];
}

const runners: Record<MlStage, (itemId: UUID, photoId: UUID) => Promise<void>> = {
	// Barcode lookup first — product databases are authoritative for a name, so
	// let it win over OCR when the item carries a barcode (no-op unless enabled).
	barcode: async (itemId) => {
		const { barcodeStage } = await import('./barcodeStage');
		await barcodeStage(itemId);
	},
	ocr: async (itemId, photoId) => {
		const { ocrStage } = await import('./ocrStage');
		await ocrStage(itemId, photoId);
	},
	embedding: async (itemId, photoId) => {
		const { embeddingStage } = await import('./embeddingStage');
		await embeddingStage(itemId, photoId);
	}
};

/**
 * Background work after a photo is saved: OCR naming, embeddings, duplicate
 * hints. Stages are dynamic imports so Tesseract/TFJS never touch the initial
 * bundle. Never blocks the shutter — callers fire and forget.
 *
 * One stage failing must not stop the others, but the outcome is now REPORTED
 * rather than swallowed into console.warn: the queue needs to know which stages
 * to retry, and the user needs to know recognition didn't happen.
 */
export async function runPostSavePipeline(
	itemId: UUID,
	photoId: UUID,
	stages: MlStage[] = ALL_STAGES
): Promise<PipelineResult> {
	const result: PipelineResult = { completed: [], failed: [] };
	// canonical order regardless of how the caller listed them
	for (const stage of ALL_STAGES.filter((s) => stages.includes(s))) {
		try {
			await runners[stage](itemId, photoId);
			result.completed.push(stage);
		} catch (error) {
			console.warn(`${stage} stage failed`, error);
			result.failed.push({ stage, error });
		}
	}
	return result;
}
