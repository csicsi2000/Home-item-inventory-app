import { base } from '$app/paths';

export interface DetectedBarcode {
	rawValue: string;
	format: string;
}

const FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code', 'data_matrix'];

type FrameReader = (video: HTMLVideoElement) => Promise<DetectedBarcode[]>;

declare global {
	interface Window {
		BarcodeDetector?: {
			new (options?: { formats?: string[] }): {
				detect(source: CanvasImageSource): Promise<{ rawValue: string; format: string }[]>;
			};
			getSupportedFormats(): Promise<string[]>;
		};
	}
}

let readerPromise: Promise<FrameReader> | null = null;

async function createReader(): Promise<FrameReader> {
	// Chrome/Android ships a native detector — zero download
	if (window.BarcodeDetector) {
		try {
			const supported = await window.BarcodeDetector.getSupportedFormats();
			const formats = FORMATS.filter((f) => supported.includes(f));
			if (formats.length) {
				const detector = new window.BarcodeDetector({ formats });
				return async (video) =>
					(await detector.detect(video)).map((b) => ({ rawValue: b.rawValue, format: b.format }));
			}
		} catch {
			// fall through to wasm
		}
	}

	// iOS Safari / Firefox / desktop: zxing-wasm, self-hosted + SW-cached for offline
	const { prepareZXingModule, readBarcodes } = await import('zxing-wasm/reader');
	prepareZXingModule({
		overrides: {
			locateFile: (path: string, prefix: string) =>
				path.endsWith('.wasm') ? `${base}/wasm/${path}` : prefix + path
		}
	});
	const canvas = document.createElement('canvas');
	return async (video) => {
		const scale = Math.min(1, 800 / Math.max(video.videoWidth, video.videoHeight));
		canvas.width = Math.round(video.videoWidth * scale);
		canvas.height = Math.round(video.videoHeight * scale);
		const ctx = canvas.getContext('2d', { willReadFrequently: true });
		if (!ctx || !canvas.width) return [];
		ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
		const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
		const results = await readBarcodes(imageData, {
			formats: ['EAN13', 'EAN8', 'UPCA', 'UPCE', 'Code128', 'Code39', 'QRCode', 'DataMatrix'],
			maxNumberOfSymbols: 1
		});
		return results
			.filter((r) => r.isValid && r.text)
			.map((r) => ({ rawValue: r.text, format: r.format }));
	};
}

function getReader(): Promise<FrameReader> {
	readerPromise ??= createReader();
	return readerPromise;
}

/** Prepare the barcode reader up front so its wasm (if any) is fetched + cached. */
export async function warmupBarcode(): Promise<void> {
	await getReader();
}

/**
 * Scan the live video at ~4 fps and report hits. Returns a stop function.
 * The same barcode is only reported once until a different one is seen.
 */
export function startBarcodeScanner(
	video: HTMLVideoElement,
	onDetect: (barcode: DetectedBarcode) => void
): () => void {
	let stopped = false;
	let last = '';

	(async () => {
		let reader: FrameReader;
		try {
			reader = await getReader();
		} catch (err) {
			console.warn('barcode reader unavailable', err);
			return;
		}
		while (!stopped) {
			if (video.readyState >= 2 && video.videoWidth > 0 && !document.hidden) {
				try {
					const results = await reader(video);
					const hit = results[0];
					if (hit && hit.rawValue !== last) {
						last = hit.rawValue;
						onDetect(hit);
					}
				} catch {
					// transient decode errors are expected
				}
			}
			await new Promise((r) => setTimeout(r, 250));
		}
	})();

	return () => {
		stopped = true;
	};
}
