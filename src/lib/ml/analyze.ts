import { recognizePhoto, type OcrOutcome } from './ocr';
import { settings } from '$lib/state/settings.svelte';

/**
 * Turn a photo into text + name candidates. With smart naming off, uses the
 * always-available Tesseract reader. With it on: Florence-2 (VLM) on WebGPU
 * devices for best quality; otherwise Tesseract for text plus a lightweight
 * caption model (CPU) to name items that have no readable text.
 */
export async function analyzePhoto(blob: Blob): Promise<OcrOutcome> {
	if (!settings.smartNaming) return recognizePhoto(blob);

	// Best path: Florence-2 on WebGPU-capable devices
	try {
		const { florenceSupported, analyzeWithFlorence } = await import('./vlm');
		if (await florenceSupported()) return await analyzeWithFlorence(blob);
	} catch (err) {
		console.warn('Florence-2 unavailable, using CPU path', err);
	}

	// CPU path (any phone): Tesseract for text …
	const base = await recognizePhoto(blob);
	if (base.candidates.length > 0) return base; // has readable text — done, no need to caption

	// … and the caption model only when there's no text to read
	try {
		const { captionImage, captionToName } = await import('./caption');
		const caption = await captionImage(blob);
		const name = captionToName(caption);
		if (name) {
			return {
				text: [base.text, caption && `(${caption})`].filter(Boolean).join('\n'),
				suggestedName: name,
				candidates: [name]
			};
		}
	} catch (err) {
		console.warn('captioning failed', err);
	}
	return base;
}
