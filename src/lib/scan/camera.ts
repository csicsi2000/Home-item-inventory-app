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
	await enableAutofocus(stream);
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

// These focus capabilities aren't in the standard TS DOM lib yet.
interface FocusCapabilities {
	focusMode?: string[];
	pointsOfInterest?: unknown;
}

function videoTrack(stream: MediaStream): MediaStreamTrack | undefined {
	return stream.getVideoTracks()[0];
}

/** Ask the camera to keep autofocusing continuously (best-effort; Android Chrome supports it). */
export async function enableAutofocus(stream: MediaStream): Promise<void> {
	const track = videoTrack(stream);
	if (!track?.getCapabilities) return;
	const caps = track.getCapabilities() as MediaTrackCapabilities & FocusCapabilities;
	if (caps.focusMode?.includes('continuous')) {
		try {
			await track.applyConstraints({
				advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet]
			});
		} catch {
			// ignore — not all devices honor this
		}
	}
}

/**
 * Focus at a normalized point (0..1 within the frame). Uses pointsOfInterest
 * and/or a single-shot refocus where the hardware exposes them. No-op otherwise.
 * Returns true if any focus constraint was accepted.
 */
export async function focusAt(stream: MediaStream, nx: number, ny: number): Promise<boolean> {
	const track = videoTrack(stream);
	if (!track?.getCapabilities) return false;
	const caps = track.getCapabilities() as MediaTrackCapabilities & FocusCapabilities;
	const advanced: Record<string, unknown> = {};
	if (caps.pointsOfInterest) {
		advanced.pointsOfInterest = [{ x: clamp01(nx), y: clamp01(ny) }];
	}
	if (caps.focusMode?.includes('single-shot')) advanced.focusMode = 'single-shot';
	else if (caps.focusMode?.includes('manual')) advanced.focusMode = 'manual';
	if (!Object.keys(advanced).length) return false;
	try {
		await track.applyConstraints({ advanced: [advanced as MediaTrackConstraintSet] });
		return true;
	} catch {
		return false;
	}
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
