export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
	if (!navigator.mediaDevices?.getUserMedia) {
		throw new Error('Camera not supported in this browser');
	}
	const stream = await navigator.mediaDevices.getUserMedia({
		video: {
			facingMode: 'environment',
			width: { ideal: 1920 },
			height: { ideal: 1080 }
		},
		audio: false
	});
	video.srcObject = stream;
	// iOS Safari: video must be inline + muted or it blacks out / goes fullscreen
	video.muted = true;
	video.playsInline = true;
	await video.play();
	return stream;
}

export function stopCamera(stream: MediaStream | null | undefined): void {
	stream?.getTracks().forEach((t) => t.stop());
}

/** Grab the current video frame at full stream resolution. */
export function grabFrame(video: HTMLVideoElement): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = video.videoWidth;
	canvas.height = video.videoHeight;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('No 2d context');
	ctx.drawImage(video, 0, 0);
	return canvas;
}
