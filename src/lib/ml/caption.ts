import { cleanLine } from './ocr';

/**
 * Lightweight image captioning (ViT-GPT2) via transformers.js, running on the
 * CPU/WASM backend — no WebGPU required, so it works on any phone. Used to name
 * items that have little or no readable text (e.g. a RAM stick, a gadget).
 */

const MODEL_ID = 'Xenova/vit-gpt2-image-captioning';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pipePromise: Promise<any> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function build(dtype: any) {
	const { pipeline } = await import('@huggingface/transformers');
	// default device is 'wasm' (CPU) — runs on any phone
	return pipeline('image-to-text', MODEL_ID, { dtype });
}

export function loadCaptioner() {
	pipePromise ??= (async () => {
		// Use the base (un-quantized) ONNX graphs — the repo's *_quantized variant
		// uses MatMulNBits nodes that fail to load in onnxruntime-web. fp16 is
		// smaller; fall back to fp32 if the runtime can't do fp16.
		try {
			return await build({ encoder_model: 'fp16', decoder_model_merged: 'fp16' });
		} catch (err) {
			console.warn('fp16 caption model failed to load, trying fp32', err);
			return await build({ encoder_model: 'fp32', decoder_model_merged: 'fp32' });
		}
	})().catch((err) => {
		pipePromise = null; // allow retry
		throw err;
	});
	return pipePromise;
}

/** Return a raw caption string for a photo. */
export async function captionImage(blob: Blob): Promise<string> {
	const { RawImage } = await import('@huggingface/transformers');
	const image = await RawImage.fromBlob(blob);
	const captioner = await loadCaptioner();
	const out = await captioner(image);
	const raw = Array.isArray(out) ? (out[0]?.generated_text ?? '') : (out?.generated_text ?? '');
	return cleanLine(String(raw));
}

/** Turn a caption into a short, Title-Cased item name. */
export function captionToName(caption: string): string | null {
	let c = cleanLine(caption)
		.replace(/^(the image (shows|is|depicts)|a picture of|an image of)\s+/i, '')
		.replace(/\.$/, '')
		.replace(/^(a|an|the)\s+/i, '');
	if (!c) return null;
	const words = c.split(/\s+/).slice(0, 8);
	return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
