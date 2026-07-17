import type { OcrOutcome } from './ocr';
import { cleanLine, rankNames, type OcrLine } from './ocr';

/**
 * Florence-2 (Microsoft) running fully in-browser via transformers.js + WebGPU.
 * One model does OCR *and* image captioning, so it reads printed text on cards
 * and can describe text-less items (a RAM stick → "a stick of memory") for
 * naming. Opt-in and WebGPU-gated — falls back to Tesseract otherwise.
 */

const MODEL_ID = 'onnx-community/Florence-2-base-ft';

/** WebGPU is required for acceptable speed; without it we don't attempt Florence. */
export async function florenceSupported(): Promise<boolean> {
	const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
	if (!gpu) return false;
	try {
		return (await gpu.requestAdapter()) != null;
	} catch {
		return false;
	}
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyProcessor = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyModel = any;

let loadPromise: Promise<{ model: AnyModel; processor: AnyProcessor; lib: typeof import('@huggingface/transformers') }> | null = null;

export function loadFlorence() {
	loadPromise ??= (async () => {
		const lib = await import('@huggingface/transformers');
		const model = await lib.Florence2ForConditionalGeneration.from_pretrained(MODEL_ID, {
			// known-good WebGPU config from the reference florence2-webgpu demo
			dtype: {
				embed_tokens: 'fp16',
				vision_encoder: 'fp16',
				encoder_model: 'fp16',
				decoder_model_merged: 'q4'
			},
			device: 'webgpu'
		});
		const processor = await lib.AutoProcessor.from_pretrained(MODEL_ID);
		return { model, processor, lib };
	})().catch((err) => {
		loadPromise = null; // allow retry
		throw err;
	});
	return loadPromise;
}

async function runTask(
	image: unknown,
	imageSize: unknown,
	task: string,
	maxNewTokens: number
): Promise<Record<string, unknown>> {
	const { model, processor } = await loadFlorence();
	const prompts = processor.construct_prompts(task);
	const inputs = await processor(image, prompts);
	const ids = await model.generate({ ...inputs, max_new_tokens: maxNewTokens });
	const text = processor.batch_decode(ids, { skip_special_tokens: false })[0];
	return processor.post_process_generation(text, task, imageSize);
}

function captionToName(caption: string): string | null {
	let c = cleanLine(caption).replace(/^the image (shows|is|depicts)\s+/i, '').replace(/\.$/, '');
	c = c.replace(/^(a|an|the)\s+/i, '');
	if (!c) return null;
	// Title Case, capped length
	const words = c.split(/\s+/).slice(0, 8);
	return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Analyze a photo with Florence-2, returning the same shape as the Tesseract path. */
export async function analyzeWithFlorence(blob: Blob): Promise<OcrOutcome> {
	const { lib } = await loadFlorence();
	const image = await lib.RawImage.fromBlob(blob);

	// OCR with regions → per-line text + boxes (for ranking the name)
	const ocr = (await runTask(image, image.size, '<OCR_WITH_REGION>', 1024)) as Record<string, unknown>;
	const region = (ocr['<OCR_WITH_REGION>'] ?? {}) as {
		labels?: string[];
		quad_boxes?: number[][];
	};
	const labels = region.labels ?? [];
	const boxes = region.quad_boxes ?? [];

	const imageHeight = Array.isArray(image.size) ? image.size[1] : (image.height ?? 1);
	const lines: OcrLine[] = labels.map((label, i) => {
		const box = boxes[i] ?? [];
		const ys = box.filter((_, k) => k % 2 === 1);
		const top = ys.length ? Math.min(...ys) : 0;
		const height = ys.length ? Math.max(...ys) - top : 0;
		return { text: label.replace(/<[^>]+>/g, ''), confidence: 95, height, top };
	});

	const candidates = rankNames(lines, imageHeight);
	const text = lines
		.map((l) => cleanLine(l.text))
		.filter((l) => l.length >= 2)
		.join('\n');

	// Caption → helps name text-less items; used as a fallback / extra candidate
	let caption = '';
	try {
		const cap = (await runTask(image, image.size, '<CAPTION>', 128)) as Record<string, unknown>;
		caption = cleanLine(String(cap['<CAPTION>'] ?? ''));
	} catch {
		// caption is optional
	}
	const captionName = captionToName(caption);

	const finalCandidates = [...candidates];
	if (captionName && !finalCandidates.some((c) => c.toLowerCase() === captionName.toLowerCase())) {
		finalCandidates.push(captionName);
	}

	// prefer real printed text; fall back to the caption for text-less items
	const suggestedName = candidates[0] ?? captionName ?? null;
	const fullText = [text, caption && `(${caption})`].filter(Boolean).join('\n');

	return { text: fullText, suggestedName, candidates: finalCandidates.slice(0, 5) };
}
