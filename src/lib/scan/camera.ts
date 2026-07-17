export async function startCamera(video: HTMLVideoElement): Promise<MediaStream> {
	if (!navigator.mediaDevices?.getUserMedia) {
		throw new Error('Camera not supported in this browser');
	}
	let stream = await navigator.mediaDevices.getUserMedia({
		video: {
			facingMode: 'environment',
			width: { ideal: 1920 },
			height: { ideal: 1080 }
		},
		audio: false
	});
	stream = await preferAutofocusCamera(stream);
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

/** Grab the current video frame at the preview stream resolution (fallback). */
export function grabFrame(video: HTMLVideoElement): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = video.videoWidth;
	canvas.height = video.videoHeight;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('No 2d context');
	ctx.drawImage(video, 0, 0);
	return canvas;
}

// ImageCapture isn't in the standard TS DOM lib.
interface ImageCaptureLike {
	takePhoto(settings?: { imageWidth?: number; imageHeight?: number }): Promise<Blob>;
	getPhotoCapabilities(): Promise<{
		imageWidth?: { max?: number };
		imageHeight?: { max?: number };
	}>;
}
interface ImageCaptureCtor {
	new (track: MediaStreamTrack): ImageCaptureLike;
}

/**
 * Take a sharp still. Prefers the ImageCapture API (real photo pipeline —
 * full sensor resolution + hardware autofocus, so it's crisp), and falls back
 * to grabbing the preview frame where ImageCapture is unavailable (iOS Safari).
 */
export async function capturePhoto(
	video: HTMLVideoElement,
	stream: MediaStream
): Promise<Blob | HTMLCanvasElement> {
	const track = stream.getVideoTracks()[0];
	const Ctor = (window as unknown as { ImageCapture?: ImageCaptureCtor }).ImageCapture;
	if (track && Ctor) {
		try {
			const capture = new Ctor(track);
			let settings: { imageWidth?: number; imageHeight?: number } | undefined;
			try {
				const caps = await capture.getPhotoCapabilities();
				if (caps?.imageWidth?.max) {
					settings = { imageWidth: caps.imageWidth.max, imageHeight: caps.imageHeight?.max };
				}
			} catch {
				// no photo capabilities — take at default resolution
			}
			const blob = await capture.takePhoto(settings);
			if (blob && blob.size > 0) return blob;
		} catch (err) {
			console.warn('takePhoto failed, using preview frame', err);
		}
	}
	return grabFrame(video);
}

// These focus capabilities aren't in the standard TS DOM lib yet.
interface FocusCapabilities {
	focusMode?: string[];
	pointsOfInterest?: unknown;
}

function videoTrack(stream: MediaStream): MediaStreamTrack | undefined {
	return stream.getVideoTracks()[0];
}

function trackSupportsContinuousFocus(track: MediaStreamTrack | undefined): boolean {
	if (!track?.getCapabilities) return false;
	const caps = track.getCapabilities() as MediaTrackCapabilities & FocusCapabilities;
	return caps.focusMode?.includes('continuous') ?? false;
}

/**
 * Multi-lens Android phones often resolve `facingMode: environment` to a
 * fixed-focus (wide/macro) lens. If the granted track can't do continuous AF,
 * probe the other rear cameras and switch to the first one that can.
 */
async function preferAutofocusCamera(stream: MediaStream): Promise<MediaStream> {
	const track = videoTrack(stream);
	if (trackSupportsContinuousFocus(track) || !navigator.mediaDevices.enumerateDevices) {
		return stream;
	}
	try {
		const currentId = track?.getSettings?.().deviceId;
		const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
			(d) =>
				d.kind === 'videoinput' &&
				d.deviceId &&
				d.deviceId !== currentId &&
				!/front|user|selfie/i.test(d.label)
		);
		for (const device of devices) {
			let candidate: MediaStream | null = null;
			try {
				candidate = await navigator.mediaDevices.getUserMedia({
					video: {
						deviceId: { exact: device.deviceId },
						width: { ideal: 1920 },
						height: { ideal: 1080 }
					},
					audio: false
				});
				if (trackSupportsContinuousFocus(videoTrack(candidate))) {
					stopCamera(stream);
					return candidate;
				}
				stopCamera(candidate);
			} catch {
				stopCamera(candidate);
			}
		}
	} catch {
		// enumeration failed — keep the original stream
	}
	return stream;
}

/** Ask the camera to keep autofocusing continuously (best-effort; Android Chrome supports it). */
export async function enableAutofocus(stream: MediaStream): Promise<void> {
	const track = videoTrack(stream);
	if (!track?.getCapabilities) return;
	const caps = track.getCapabilities() as MediaTrackCapabilities & FocusCapabilities;
	if (!caps.focusMode?.includes('continuous')) return;
	// Chrome versions differ on whether focusMode belongs top-level or in
	// `advanced` — try both; whichever the device honors wins.
	try {
		await track.applyConstraints({ focusMode: 'continuous' } as MediaTrackConstraints);
	} catch {
		// fall through to the advanced form
	}
	try {
		await track.applyConstraints({
			advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet]
		});
	} catch {
		// ignore — not all devices honor this
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
	// single-shot only — 'manual' with no focusDistance would lock the lens in place
	if (caps.focusMode?.includes('single-shot')) advanced.focusMode = 'single-shot';
	if (!Object.keys(advanced).length) return false;
	try {
		await track.applyConstraints({ advanced: [advanced as MediaTrackConstraintSet] });
		return true;
	} catch {
		return false;
	} finally {
		// hand control back to continuous AF once the single-shot has converged,
		// so one tap doesn't leave focus frozen for the rest of the session
		if (advanced.focusMode) {
			setTimeout(() => {
				enableAutofocus(stream).catch(() => {});
			}, 1500);
		}
	}
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
