import { base } from '$app/paths';
import { createWorker, type Worker } from 'tesseract.js';

/**
 * On-device OCR via Tesseract.js. All assets (worker, wasm core, eng
 * traineddata) are self-hosted under /tesseract and cached by the service
 * worker, so this works offline after first use.
 */

let workerPromise: Promise<Worker> | null = null;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

const IDLE_TERMINATE_MS = 60_000;

function getWorker(): Promise<Worker> {
	workerPromise ??= createWorker('eng', 1 /* LSTM only */, {
		workerPath: `${base}/tesseract/worker.min.js`,
		corePath: `${base}/tesseract/core`,
		langPath: `${base}/tesseract/lang`
	});
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
	/** Best guess for an item name (most prominent confident line). */
	suggestedName: string | null;
}

interface OcrLine {
	text: string;
	confidence: number;
	height: number;
	top: number;
}

function cleanLine(raw: string): string {
	return raw
		.replace(/[|_~^`]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

function suggestName(lines: OcrLine[], imageHeight: number): string | null {
	let best: { score: number; text: string } | null = null;
	for (const line of lines) {
		const text = cleanLine(line.text);
		const letters = text.replace(/[^\p{L}\p{N}]/gu, '');
		if (text.length < 3 || text.length > 60 || letters.length < 3) continue;
		if (line.confidence < 60) continue;
		// prominence = text size, with a bonus for being near the top (titles usually are)
		const positionBonus = 1 - 0.35 * Math.min(1, line.top / Math.max(1, imageHeight));
		const score = line.height * positionBonus * (line.confidence / 100);
		if (!best || score > best.score) best = { score, text };
	}
	return best?.text ?? null;
}

/** OCR one photo blob. */
export async function recognizePhoto(blob: Blob): Promise<OcrOutcome> {
	const worker = await getWorker();
	const { data } = await worker.recognize(blob, {}, { blocks: true, text: true });

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

	return { text, suggestedName: suggestName(lines, imageBottom) };
}
