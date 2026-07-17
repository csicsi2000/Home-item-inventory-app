import { recognizePhoto, type OcrOutcome } from './ocr';
import { settings } from '$lib/state/settings.svelte';

/**
 * Turn a photo into text + name candidates. Uses the opt-in Florence-2 VLM when
 * enabled and WebGPU is available; otherwise the always-available Tesseract path.
 */
export async function analyzePhoto(blob: Blob): Promise<OcrOutcome> {
	if (settings.smartNaming) {
		try {
			const { florenceSupported, analyzeWithFlorence } = await import('./vlm');
			if (await florenceSupported()) {
				return await analyzeWithFlorence(blob);
			}
		} catch (err) {
			console.warn('Florence-2 failed, falling back to Tesseract', err);
		}
	}
	return recognizePhoto(blob);
}
