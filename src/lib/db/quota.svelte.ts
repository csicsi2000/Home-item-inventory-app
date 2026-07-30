/**
 * Storage-quota handling for a local-first app whose source of truth is
 * IndexedDB full of 1600px WebPs.
 *
 * Running out of space is the single most likely IndexedDB failure on a phone,
 * and nothing handled it: `db.photos.update` would throw inside a try that
 * swallowed the error into console.warn, so the user's next scan silently failed
 * to save its image.
 */

class StorageState {
	/** Set once a write has actually been refused for want of space. */
	full = $state(false);
	/** 0–1, from navigator.storage.estimate(); null when unavailable. */
	usedFraction = $state<number | null>(null);
	/** True once the origin is exempt from eviction. */
	persisted = $state<boolean | null>(null);
}

export const storage = new StorageState();

/** Above this, stop pulling more photos down from the cloud. */
const HYDRATE_CEILING = 0.95;

export function isQuotaError(err: unknown): boolean {
	// Dexie wraps the DOMException, so check the name and the message
	if (err instanceof DOMException && err.name === 'QuotaExceededError') return true;
	if (err && typeof err === 'object') {
		const { name, message } = err as { name?: string; message?: string };
		if (name === 'QuotaExceededError' || name === 'QuotaExceededError2') return true;
		if (typeof message === 'string' && message.includes('QuotaExceeded')) return true;
	}
	return false;
}

/**
 * Run a storage write, converting "out of space" into a null result plus a
 * one-time user-visible warning. Any other error propagates untouched.
 */
export async function withQuotaGuard<T>(fn: () => Promise<T>): Promise<T | null> {
	try {
		const result = await fn();
		storage.full = false;
		return result;
	} catch (err) {
		if (!isQuotaError(err)) throw err;
		if (!storage.full) {
			storage.full = true;
			const { toast } = await import('svelte-sonner');
			toast.error("This device is out of storage — new photos can't be saved.", {
				description: 'Free some space, or delete items you no longer need.',
				duration: 10_000
			});
		}
		console.warn('storage quota exceeded', err);
		return null;
	}
}

export async function refreshStorageEstimate(): Promise<number | null> {
	if (!navigator.storage?.estimate) return null;
	try {
		const { usage, quota } = await navigator.storage.estimate();
		if (!usage || !quota) return null;
		storage.usedFraction = usage / quota;
		return storage.usedFraction;
	} catch {
		return null;
	}
}

/** Whether there's room to keep downloading photos. */
export async function hasRoomToHydrate(): Promise<boolean> {
	const used = await refreshStorageEstimate();
	return used === null || used < HYDRATE_CEILING;
}

/**
 * Ask the browser to exempt this origin from eviction. An unpersisted origin can
 * be cleared wholesale under storage pressure, which in a local-first app means
 * losing everything that hasn't synced.
 */
export async function ensurePersisted(): Promise<boolean | null> {
	if (!navigator.storage?.persist || !navigator.storage.persisted) return null;
	try {
		storage.persisted =
			(await navigator.storage.persisted()) || (await navigator.storage.persist());
		return storage.persisted;
	} catch {
		return null;
	}
}

const ASKED_KEY = 'persist-requested';

/**
 * Request persistence at most once, and only once the user has something worth
 * protecting.
 *
 * Chromium grants this silently from engagement heuristics, but Firefox shows a
 * permission prompt — so asking on an empty first run would interrupt a user with
 * nothing at stake, and asking mid-scan would interrupt the shutter.
 */
export async function maybeRequestPersistence(): Promise<void> {
	if (!navigator.storage?.persisted) return;
	try {
		if (await navigator.storage.persisted()) {
			storage.persisted = true;
			return;
		}
		const { db } = await import('./schema');
		if (await db.meta.get(ASKED_KEY)) return;
		if ((await db.items.count()) === 0) return;
		await db.meta.put({ key: ASKED_KEY, value: new Date().toISOString() });
		await ensurePersisted();
	} catch {
		/* best effort */
	}
}
