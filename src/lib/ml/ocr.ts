import { base } from '$app/paths';
import { createWorker, PSM, type Worker } from 'tesseract.js';

/**
 * On-device OCR via Tesseract.js. All assets (worker, wasm core, eng
 * traineddata) are self-hosted under /tesseract and cached by the service
 * worker, so this works offline after first use.
 */

let workerPromise: Promise<Worker> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

const IDLE_TERMINATE_MS = 60_000;

function getWorker(): Promise<Worker> {
	workerPromise ??= (async () => {
		const worker = await createWorker('eng', 1 /* LSTM only */, {
			workerPath: `${base}/tesseract/worker.min.js`,
			corePath: `${base}/tesseract/core`,
			langPath: `${base}/tesseract/lang`
		});
		await worker.setParameters({
			// photographed cards rarely carry DPI metadata — pin it so Tesseract
			// doesn't misjudge scale (a common cause of missed large titles)
			user_defined_dpi: '300',
			tessedit_pageseg_mode: PSM.AUTO,
			preserve_interword_spaces: '1'
		});
		return worker;
	})();
	return workerPromise;
}

/** Free ~100MB of wasm memory when OCR hasn't been used for a while. */
function scheduleIdleTerminate() {
	clearTimeout(idleTimer);
	idleTimer = setTimeout(async () => {
		const promise = workerPromise;
		workerPromise = null;
		try {
			await (await promise)?.terminate();
		} catch {
			// already gone
		}
	}, IDLE_TERMINATE_MS);
}

export interface OcrOutcome {
	/** Cleaned multi-line text found on the item. */
	text: string;
	/** Best guess for an item name (top-ranked candidate). */
	suggestedName: string | null;
	/** Ranked, de-duplicated name candidates — the UI lets the user pick. */
	candidates: string[];
}

export interface OcrLine {
	text: string;
	confidence: number;
	height: number;
	top: number;
}

export function cleanLine(raw: string): string {
	return raw
		.replace(/[|_~^`]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Grayscale + percentile contrast-stretch, upscaling small images. Tesseract
 * is far more reliable on high-contrast, adequately-sized text than on a raw
 * photo where the title competes with artwork and gradients.
 */
async function preprocess(blob: Blob): Promise<HTMLCanvasElement> {
	const bitmap = await createImageBitmap(blob);
	const longer = Math.max(bitmap.width, bitmap.height);
	const scale = Math.min(2, Math.max(1, 1600 / longer));
	const w = Math.round(bitmap.width * scale);
	const h = Math.round(bitmap.height * scale);

	const canvas = document.createElement('canvas');
	canvas.width = w;
	canvas.height = h;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('No 2d context');
	ctx.drawImage(bitmap, 0, 0, w, h);
	bitmap.close();

	const img = ctx.getImageData(0, 0, w, h);
	const d = img.data;
	const n = w * h;
	const lum = new Uint8ClampedArray(n);
	const hist = new Uint32Array(256);
	for (let i = 0; i < n; i++) {
		const o = i * 4;
		const y = (0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2]) | 0;
		lum[i] = y;
		hist[y]++;
	}
	// clip the darkest 2% / brightest 2% so a few outlier pixels don't flatten contrast
	const lowCut = n * 0.02;
	const highCut = n * 0.98;
	let acc = 0;
	let lo = 0;
	let hi = 255;
	for (let v = 0; v < 256; v++) {
		acc += hist[v];
		if (acc >= lowCut) {
			lo = v;
			break;
		}
	}
	acc = 0;
	for (let v = 0; v < 256; v++) {
		acc += hist[v];
		if (acc >= highCut) {
			hi = v;
			break;
		}
	}
	const range = Math.max(1, hi - lo);
	for (let i = 0; i < n; i++) {
		const o = i * 4;
		const v = Math.min(255, Math.max(0, ((lum[i] - lo) * 255) / range));
		d[o] = d[o + 1] = d[o + 2] = v;
	}
	ctx.putImageData(img, 0, 0);
	return canvas;
}

const COPYRIGHT_RE = /©|®|™|\bcopyright\b|\ball rights\b|\bltd\b|\binc\b|\btcg\b/i;

/** Score a line's likelihood of being the item's name; null = not a candidate. */
function scoreName(line: OcrLine, imageHeight: number): number | null {
	const text = cleanLine(line.text);
	const letters = (text.match(/\p{L}/gu) ?? []).length;
	const digits = (text.match(/\p{N}/gu) ?? []).length;
	if (text.length < 2 || text.length > 40) return null;
	if (letters < 2) return null;
	if (letters / text.length < 0.55) return null; // mostly symbols/punctuation
	if (digits > letters) return null; // stat/number lines
	if (COPYRIGHT_RE.test(text)) return null;
	if (line.confidence < 30) return null;

	// prominence is dominated by text height (titles are the biggest text)
	const topFrac = line.top / Math.max(1, imageHeight);
	const positionBonus = 1 - 0.2 * Math.min(1, topFrac); // mild preference for upper area
	const nameish =
		text === text.toUpperCase() ||
		/^[\p{Lu}][\p{L}'.-]*(\s+[\p{Lu}&][\p{L}'.-]*)*$/u.test(text); // ALL CAPS or Title Case
	const caseBonus = nameish ? 1.3 : 1;
	const confWeight = 0.5 + 0.5 * (line.confidence / 100); // don't let low conf zero it out
	return line.height * positionBonus * caseBonus * confWeight;
}

export function rankNames(lines: OcrLine[], imageHeight: number): string[] {
	const scored = lines
		.map((l) => ({ text: cleanLine(l.text), score: scoreName(l, imageHeight) }))
		.filter((x): x is { text: string; score: number } => x.score !== null)
		.sort((a, b) => b.score - a.score);

	const seen = new Set<string>();
	const out: string[] = [];
	for (const x of scored) {
		const key = x.text.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(x.text);
		if (out.length >= 5) break;
	}
	return out;
}

/** OCR one photo blob. */
export async function recognizePhoto(blob: Blob): Promise<OcrOutcome> {
	const worker = await getWorker();
	// preprocess for accuracy; fall back to the raw blob if canvas work fails
	let input: Blob | HTMLCanvasElement = blob;
	try {
		input = await preprocess(blob);
	} catch (err) {
		console.warn('OCR preprocess failed, using raw image', err);
	}
	const { data } = await worker.recognize(input, {}, { blocks: true, text: true });

	const lines: OcrLine[] = [];
	let imageBottom = 1;
	for (const block of data.blocks ?? []) {
		for (const paragraph of block.paragraphs) {
			for (const line of paragraph.lines) {
				lines.push({
					text: line.text,
					confidence: line.confidence,
					height: line.bbox.y1 - line.bbox.y0,
					top: line.bbox.y0
				});
				imageBottom = Math.max(imageBottom, line.bbox.y1);
			}
		}
	}

	scheduleIdleTerminate();

	const text = lines
		.map((l) => cleanLine(l.text))
		.filter((l) => l.length >= 2 && l.replace(/[^\p{L}\p{N}]/gu, '').length >= 2)
		.join('\n');

	const candidates = rankNames(lines, imageBottom);
	return { text, suggestedName: candidates[0] ?? null, candidates };
}
