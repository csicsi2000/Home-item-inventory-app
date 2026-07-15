/**
 * 64-bit DCT perceptual hash — a cheap first-pass duplicate signal.
 * Two photos of the same card (similar framing) land within a small
 * Hamming distance even across compression/lighting changes.
 */

const SIZE = 32;
const REGION = 8;

// precomputed DCT-II cosine table
const COS = new Float64Array(SIZE * SIZE);
for (let u = 0; u < SIZE; u++) {
	for (let x = 0; x < SIZE; x++) {
		COS[u * SIZE + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * SIZE));
	}
}

function dct2d(gray: Float64Array): Float64Array {
	// rows then columns
	const tmp = new Float64Array(SIZE * SIZE);
	const out = new Float64Array(SIZE * SIZE);
	for (let y = 0; y < SIZE; y++) {
		for (let u = 0; u < REGION; u++) {
			let sum = 0;
			for (let x = 0; x < SIZE; x++) sum += gray[y * SIZE + x] * COS[u * SIZE + x];
			tmp[y * SIZE + u] = sum;
		}
	}
	for (let u = 0; u < REGION; u++) {
		for (let v = 0; v < REGION; v++) {
			let sum = 0;
			for (let y = 0; y < SIZE; y++) sum += tmp[y * SIZE + u] * COS[v * SIZE + y];
			out[v * SIZE + u] = sum;
		}
	}
	return out;
}

export function phashFromCanvasData(data: Uint8ClampedArray): string {
	const gray = new Float64Array(SIZE * SIZE);
	for (let i = 0; i < SIZE * SIZE; i++) {
		const o = i * 4;
		gray[i] = 0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2];
	}
	const dct = dct2d(gray);

	// top-left 8x8 low-frequency block, DC term excluded from the median
	const coeffs: number[] = [];
	for (let v = 0; v < REGION; v++) {
		for (let u = 0; u < REGION; u++) {
			if (u === 0 && v === 0) continue;
			coeffs.push(dct[v * SIZE + u]);
		}
	}
	const sorted = [...coeffs].sort((a, b) => a - b);
	const median = sorted[Math.floor(sorted.length / 2)];

	let hash = '';
	let nibble = 0;
	let bits = 0;
	// include DC as bit 0 (always ≥ median in practice, keeps 64 bits even)
	const allBits = [dct[0], ...coeffs];
	for (const c of allBits) {
		nibble = (nibble << 1) | (c > median ? 1 : 0);
		bits++;
		if (bits === 4) {
			hash += nibble.toString(16);
			nibble = 0;
			bits = 0;
		}
	}
	return hash;
}

export async function phash(source: Blob | HTMLCanvasElement): Promise<string> {
	const canvas = document.createElement('canvas');
	canvas.width = SIZE;
	canvas.height = SIZE;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('No 2d context');
	if (source instanceof Blob) {
		const bitmap = await createImageBitmap(source);
		ctx.drawImage(bitmap, 0, 0, SIZE, SIZE);
		bitmap.close();
	} else {
		ctx.drawImage(source, 0, 0, SIZE, SIZE);
	}
	return phashFromCanvasData(ctx.getImageData(0, 0, SIZE, SIZE).data);
}

export function hammingDistance(a: string, b: string): number {
	if (a.length !== b.length) return 64;
	let distance = 0;
	for (let i = 0; i < a.length; i++) {
		let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
		while (x) {
			distance += x & 1;
			x >>= 1;
		}
	}
	return distance;
}
