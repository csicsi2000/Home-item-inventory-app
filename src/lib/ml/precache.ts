/**
 * Warm up every on-device recognition model so their assets land in the service
 * worker's runtime caches (`ml-assets`, `hf-models`). After this runs in the
 * installed/production app, scanning works fully offline from the very first use.
 *
 * The models are large (Florence-2 alone is ~1GB), so steps run sequentially to
 * bound memory. Each step is independent — one failure doesn't abort the rest.
 */

import { settings } from '$lib/state/settings.svelte';

export interface PrecacheProgress {
	step: number;
	total: number;
	label: string;
}

export interface PrecacheResult {
	ok: string[];
	failed: string[];
}

interface Step {
	label: string;
	run: () => Promise<unknown>;
}

function buildSteps(): Step[] {
	const steps: Step[] = [
		{ label: 'Text recognition', run: async () => (await import('./ocr')).warmupOcr() },
		{ label: 'Duplicate detection', run: async () => (await import('./embeddings')).getEmbedder() },
		{ label: 'Barcode scanner', run: async () => (await import('../scan/barcode')).warmupBarcode() }
	];
	if (settings.smartNaming) {
		steps.push({
			label: 'Smart AI naming',
			run: async () => {
				const { florenceSupported, loadFlorence } = await import('./vlm');
				if (await florenceSupported()) {
					await loadFlorence();
				} else {
					await (await import('./caption')).loadCaptioner();
				}
			}
		});
	}
	return steps;
}

export async function precacheModels(
	onProgress: (p: PrecacheProgress) => void
): Promise<PrecacheResult> {
	const steps = buildSteps();
	const result: PrecacheResult = { ok: [], failed: [] };
	for (let i = 0; i < steps.length; i++) {
		const step = steps[i];
		onProgress({ step: i + 1, total: steps.length, label: step.label });
		try {
			await step.run();
			result.ok.push(step.label);
		} catch (err) {
			console.warn(`precache "${step.label}" failed`, err);
			result.failed.push(step.label);
		}
	}
	return result;
}

export type PrecacheStatus = 'cached' | 'partial' | 'none' | 'unsupported';

// URL fragments that indicate a given model's assets are already cached
const SENTINELS = ['/tesseract/', '/models/mobilenet/model.json', '.wasm'];

/**
 * Best-effort probe of the Workbox runtime caches to tell whether models have
 * already been downloaded. Returns 'unsupported' where the Cache API or an
 * active service worker isn't available (e.g. the dev server).
 */
export async function precacheStatus(): Promise<PrecacheStatus> {
	if (typeof caches === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
	if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) return 'unsupported';
	try {
		const urls: string[] = [];
		for (const name of ['ml-assets', 'hf-models']) {
			if (!(await caches.has(name))) continue;
			const cache = await caches.open(name);
			for (const req of await cache.keys()) urls.push(req.url);
		}
		if (urls.length === 0) return 'none';
		const hit = SENTINELS.filter((s) => urls.some((u) => u.includes(s))).length;
		if (hit >= SENTINELS.length) return 'cached';
		return 'partial';
	} catch {
		return 'unsupported';
	}
}
