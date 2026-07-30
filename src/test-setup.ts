// Shared vitest setup for the `server` (node) project.
//
// Dexie needs a real IndexedDB, and several modules read navigator.onLine —
// which is undefined under node, so `navigator.onLine ? a : b` would silently
// take the offline branch in every test.

import 'fake-indexeddb/auto';

// Device preferences (settings, dismissed hints) live in localStorage, which
// node doesn't have. An in-memory stand-in keeps those code paths reachable.
if (typeof globalThis.localStorage === 'undefined') {
	const store = new Map<string, string>();
	Object.defineProperty(globalThis, 'localStorage', {
		configurable: true,
		value: {
			get length() {
				return store.size;
			},
			key: (i: number) => [...store.keys()][i] ?? null,
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, String(v)),
			removeItem: (k: string) => void store.delete(k),
			clear: () => store.clear()
		} satisfies Storage
	});
}

if (typeof navigator === 'undefined') {
	Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
} else if (navigator.onLine === undefined) {
	Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
}
