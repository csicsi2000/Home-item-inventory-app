import { liveQuery } from 'dexie';

/**
 * Module-level reactive wrapper around a Dexie liveQuery.
 * Lives for the whole app session — use `live()` inside components instead.
 *
 * `loaded` starts false and flips true on the first emission, so callers can
 * tell "still loading" apart from "resolved to empty" (avoids flashing an
 * empty state before IndexedDB answers).
 */
export class Live<T> {
	current = $state() as T;
	loaded = $state(false);

	constructor(querier: () => T | Promise<T>, initial: T) {
		this.current = initial;
		if (typeof indexedDB !== 'undefined') {
			liveQuery(querier).subscribe({
				next: (v) => {
					this.current = v;
					this.loaded = true;
				}
			});
		} else {
			// no IndexedDB (SSR/tests): nothing to wait for
			this.loaded = true;
		}
	}
}

/**
 * Component-scoped live query with cleanup. Re-subscribes whenever `deps()`
 * (read reactively) changes — pass route params etc. through it.
 * Must be called during component initialization.
 *
 * Exposes `loaded`, false until the first emission of the current
 * subscription (reset on every re-subscribe so a dep change re-shows loading).
 */
export function live<T>(querier: () => T | Promise<T>, initial: T, deps?: () => unknown) {
	let current = $state(initial);
	let loaded = $state(false);
	$effect(() => {
		deps?.();
		loaded = false;
		const sub = liveQuery(querier).subscribe({
			next: (v) => {
				current = v;
				loaded = true;
			}
		});
		return () => sub.unsubscribe();
	});
	return {
		get current() {
			return current;
		},
		get loaded() {
			return loaded;
		}
	};
}
