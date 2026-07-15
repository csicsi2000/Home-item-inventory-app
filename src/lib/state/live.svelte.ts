import { liveQuery } from 'dexie';

/**
 * Module-level reactive wrapper around a Dexie liveQuery.
 * Lives for the whole app session — use `live()` inside components instead.
 */
export class Live<T> {
	current = $state() as T;

	constructor(querier: () => T | Promise<T>, initial: T) {
		this.current = initial;
		if (typeof indexedDB !== 'undefined') {
			liveQuery(querier).subscribe({ next: (v) => (this.current = v) });
		}
	}
}

/**
 * Component-scoped live query with cleanup. Re-subscribes whenever `deps()`
 * (read reactively) changes — pass route params etc. through it.
 * Must be called during component initialization.
 */
export function live<T>(querier: () => T | Promise<T>, initial: T, deps?: () => unknown) {
	let current = $state(initial);
	$effect(() => {
		deps?.();
		const sub = liveQuery(querier).subscribe({ next: (v) => (current = v) });
		return () => sub.unsubscribe();
	});
	return {
		get current() {
			return current;
		}
	};
}
