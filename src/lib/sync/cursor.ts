import type { SyncState } from '$lib/db/types';

/**
 * Where a table's pull got to, as a composite key.
 *
 * A plain `server_updated_at > last` cursor is unsafe here:
 * `touch_server_updated_at()` sets the column from `now()`, the TRANSACTION
 * timestamp, so every row written by one statement shares a value. When a page
 * boundary lands inside such a group the cursor advances past the whole
 * timestamp and the remaining rows are never pulled again — silent data loss on
 * any bulk import or multi-row edit.
 *
 * Paging by `(server_updated_at, id)` fixes that: the pair is unique because
 * `id` is the primary key, so the cursor can always resume mid-group.
 */
export interface PullCursor {
	/**
	 * RAW `server_updated_at` from the server, never re-formatted. Postgres
	 * timestamps carry microseconds; `new Date(x).toISOString()` truncates to
	 * milliseconds, and a cursor truncated down re-pulls a page every sync while
	 * one truncated up skips rows.
	 */
	ts: string;
	/** null on a cursor written before keyset pagination, or at the epoch. */
	id: string | null;
}

export const EPOCH = '1970-01-01T00:00:00Z';
export const EPOCH_CURSOR: PullCursor = { ts: EPOCH, id: null };

export function readCursor(state: SyncState | undefined): PullCursor {
	if (!state) return EPOCH_CURSOR;
	return { ts: state.lastPulledAt, id: state.lastPulledId ?? null };
}

/**
 * PostgREST `or=` expression for "strictly after this composite key".
 *
 * The values are double-quoted because a rendered `timestamptz` contains `:`,
 * `.`, `,` and `+`, every one of which PostgREST treats as filter syntax.
 */
export function keysetFilter(cursor: PullCursor): string {
	const ts = quote(cursor.ts);
	if (cursor.id === null) return `server_updated_at.gt.${ts}`;
	return `server_updated_at.gt.${ts},and(server_updated_at.eq.${ts},id.gt.${quote(cursor.id)})`;
}

const quote = (value: string): string => `"${value.replace(/["\\]/g, '\\$&')}"`;

/**
 * Advance to the last row of a page. Returns `prev` unchanged when the page is
 * empty or its rows carry no usable `server_updated_at` (a table whose trigger
 * is missing), which callers use as a "no progress, stop" signal instead of
 * looping forever.
 */
export function advanceCursor(
	rows: Record<string, unknown>[],
	prev: PullCursor
): PullCursor {
	for (let i = rows.length - 1; i >= 0; i--) {
		const ts = rows[i].server_updated_at;
		const id = rows[i].id;
		if (ts == null || id == null) continue;
		return { ts: String(ts), id: String(id) };
	}
	return prev;
}

export const sameCursor = (a: PullCursor, b: PullCursor): boolean =>
	a.ts === b.ts && a.id === b.id;
