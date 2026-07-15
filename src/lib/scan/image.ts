const FULL_MAX_EDGE = 1600;
const THUMB_MAX_EDGE = 300;
const QUALITY = 0.8;

export interface ProcessedImage {
	blob: Blob;
	thumb: Blob;
	width: number;
	height: number;
}

function scaleToFit(width: number, height: number, maxEdge: number) {
	const scale = Math.min(1, maxEdge / Math.max(width, height));
	return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

async function encodeCanvas(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
	const tryType = (type: string) =>
		new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
	// WebP everywhere modern; JPEG as a safety net for old Safari
	const webp = await tryType('image/webp');
	if (webp && webp.type === 'image/webp') return webp;
	const jpeg = await tryType('image/jpeg');
	if (jpeg) return jpeg;
	throw new Error('Canvas encoding failed');
}

function draw(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('No 2d context');
	ctx.drawImage(source, 0, 0, width, height);
	return canvas;
}

/** Compress a photo (file upload or camera frame) into full-res + thumbnail WebP. */
export async function processImage(source: Blob | HTMLCanvasElement): Promise<ProcessedImage> {
	let bitmap: ImageBitmap | HTMLCanvasElement;
	let srcWidth: number;
	let srcHeight: number;
	if (source instanceof Blob) {
		// respects EXIF rotation from phone cameras
		bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
		srcWidth = bitmap.width;
		srcHeight = bitmap.height;
	} else {
		bitmap = source;
		srcWidth = source.width;
		srcHeight = source.height;
	}

	const full = scaleToFit(srcWidth, srcHeight, FULL_MAX_EDGE);
	const thumbSize = scaleToFit(srcWidth, srcHeight, THUMB_MAX_EDGE);

	const fullCanvas = draw(bitmap, full.width, full.height);
	const thumbCanvas = draw(bitmap, thumbSize.width, thumbSize.height);
	if (bitmap instanceof ImageBitmap) bitmap.close();

	const [blob, thumb] = await Promise.all([
		encodeCanvas(fullCanvas, QUALITY),
		encodeCanvas(thumbCanvas, QUALITY)
	]);
	return { blob, thumb, width: full.width, height: full.height };
}

/** Decode a stored photo blob into a canvas at a bounded size (for ML pipelines). */
export async function blobToCanvas(blob: Blob, maxEdge = FULL_MAX_EDGE): Promise<HTMLCanvasElement> {
	const bitmap = await createImageBitmap(blob);
	const { width, height } = scaleToFit(bitmap.width, bitmap.height, maxEdge);
	const canvas = draw(bitmap, width, height);
	bitmap.close();
	return canvas;
}
