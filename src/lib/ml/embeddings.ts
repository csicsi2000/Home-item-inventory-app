import { base } from '$app/paths';

/**
 * MobileNet v2 (α0.5) feature vectors via TFJS — self-hosted ~2.7MB weights,
 * lazy-loaded on first duplicate check, cached by the service worker.
 */

type TF = typeof import('@tensorflow/tfjs-core');
type GraphModel = import('@tensorflow/tfjs-converter').GraphModel;

const INPUT_SIZE = 224;

let loaded: Promise<{ tf: TF; model: GraphModel }> | null = null;

async function load(): Promise<{ tf: TF; model: GraphModel }> {
	const tf = await import('@tensorflow/tfjs-core');
	const { loadGraphModel } = await import('@tensorflow/tfjs-converter');

	let backendReady = false;
	try {
		await import('@tensorflow/tfjs-backend-webgl');
		backendReady = await tf.setBackend('webgl');
	} catch {
		backendReady = false;
	}
	if (!backendReady) {
		const wasm = await import('@tensorflow/tfjs-backend-wasm');
		wasm.setWasmPaths(`${base}/wasm/tfjs/`);
		await tf.setBackend('wasm');
	}
	await tf.ready();

	const model = await loadGraphModel(`${base}/models/mobilenet/model.json`);
	// warm-up so the first real inference isn't slow
	const warm = tf.tidy(() => model.predict(tf.zeros([1, INPUT_SIZE, INPUT_SIZE, 3])));
	await (Array.isArray(warm) ? warm[0] : (warm as import('@tensorflow/tfjs-core').Tensor)).data();
	(Array.isArray(warm) ? warm : [warm]).forEach((t) => (t as { dispose(): void }).dispose());
	return { tf, model };
}

export function getEmbedder(): Promise<{ tf: TF; model: GraphModel }> {
	loaded ??= load().catch((err) => {
		loaded = null; // allow retry (e.g. transient offline before assets were cached)
		throw err;
	});
	return loaded;
}

function to224(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = INPUT_SIZE;
	canvas.height = INPUT_SIZE;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('No 2d context');
	// center-crop to square so framing differences matter less
	const edge = Math.min(width, height);
	ctx.drawImage(
		source,
		(width - edge) / 2,
		(height - edge) / 2,
		edge,
		edge,
		0,
		0,
		INPUT_SIZE,
		INPUT_SIZE
	);
	return canvas;
}

/** Compute an L2-normalized feature vector for a photo. */
export async function embed(source: Blob | HTMLCanvasElement): Promise<Float32Array> {
	const { tf, model } = await getEmbedder();

	let canvas: HTMLCanvasElement;
	if (source instanceof Blob) {
		const bitmap = await createImageBitmap(source);
		canvas = to224(bitmap, bitmap.width, bitmap.height);
		bitmap.close();
	} else {
		canvas = to224(source, source.width, source.height);
	}

	const output = tf.tidy(() => {
		const pixels = tf.browser.fromPixels(canvas);
		const input = tf.expandDims(tf.div(tf.cast(pixels, 'float32'), 255), 0);
		const result = model.predict(input);
		const tensor = Array.isArray(result) ? result[0] : (result as import('@tensorflow/tfjs-core').Tensor);
		return tf.squeeze(tensor);
	});
	try {
		const raw = (await output.data()) as Float32Array;
		let norm = 0;
		for (let i = 0; i < raw.length; i++) norm += raw[i] * raw[i];
		norm = Math.sqrt(norm) || 1;
		const vector = new Float32Array(raw.length);
		for (let i = 0; i < raw.length; i++) vector[i] = raw[i] / norm;
		return vector;
	} finally {
		output.dispose();
	}
}

/** Cosine similarity of two L2-normalized vectors = dot product. */
export function cosine(a: Float32Array, b: Float32Array): number {
	if (a.length !== b.length) return 0;
	let dot = 0;
	for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
	return dot;
}
