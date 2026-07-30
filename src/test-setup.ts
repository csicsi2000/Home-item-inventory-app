// Shared vitest setup for the `server` (node) project.
//
// Dexie needs a real IndexedDB, and several modules read navigator.onLine —
// which is undefined under node, so `navigator.onLine ? a : b` would silently
// take the offline branch in every test.

import 'fake-indexeddb/auto';

if (typeof navigator === 'undefined') {
	Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
} else if (navigator.onLine === undefined) {
	Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
}
