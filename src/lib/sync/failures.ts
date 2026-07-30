import { db } from '$lib/db/schema';
import type { SyncFailure } from '$lib/db/types';

/**
 * Push-side quarantine.
 *
 * A row the server permanently refuses — an RLS denial on a read-only share, a
 * column a not-yet-applied migration lacks, a constraint violation — used to
 * throw out of push() and abort the whole sync before pull(). The device then
 * stopped *receiving* data too, forever, with no recovery but clearing site
 * data. Quarantined rows are skipped so everything else keeps flowing; they stay
 * `dirty: 1`, so nothing is ever discarded.
 */

export type PushErrorKind = 'transient' | 'permanent' | 'schema';

export interface PushError {
	code?: string | null;
	message: string;
	status?: number;
}

/** Rethrown so syncNow() can treat "try again later" as today's error state. */
export class TransientSyncError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TransientSyncError';
	}
}

const MINUTE = 60_000;
const MAX_BACKOFF = 24 * 60 * MINUTE;
/** Past this many attempts a row waits for an explicit user retry. */
export const MAX_ATTEMPTS = 5;
/** Far enough out to mean "never on a timer". */
const FOREVER = '9999-12-31T00:00:00.000Z';

export const failureKey = (table: string, rowId: string): string => `${table}:${rowId}`;

export function backoffMs(attempts: number): number {
	return Math.min(2 ** attempts * MINUTE, MAX_BACKOFF);
}

/**
 * Classify what the server said.
 *
 * `schema` matters as its own kind: when a column is missing, *every* row of the
 * table fails identically, so bisecting a 400-row chunk would cost ~800 pointless
 * requests to learn one fact.
 */
export function classifyPushError(error: PushError): PushErrorKind {
	const code = error.code ?? '';
	const message = error.message.toLowerCase();
	const status = error.status ?? 0;

	if (code === 'PGRST204' || code === '42703' || message.includes('column')) return 'schema';
	if (code === '42501' || status === 403 || message.includes('row-level security')) {
		return 'permanent';
	}
	if (/^(23|22)/.test(code)) return 'permanent';
	if (status === 429 || status >= 500) return 'transient';
	if (
		message.includes('fetch') ||
		message.includes('network') ||
		message.includes('timeout') ||
		message.includes('load failed')
	) {
		return 'transient';
	}
	// Unknown: treat as permanent so it gets isolated and surfaced rather than
	// retried forever at full volume. A user retry clears it.
	return 'permanent';
}

/** Keys currently blocked from being pushed. */
export async function activeFailureKeys(now: string): Promise<Set<string>> {
	const rows = await db.syncFailures.toArray();
	return new Set(rows.filter((f) => f.nextAttemptAt > now).map((f) => f.key));
}

export async function recordFailure(
	table: string,
	rowId: string,
	updatedAt: string,
	error: PushError,
	now: string = new Date().toISOString()
): Promise<void> {
	const key = failureKey(table, rowId);
	const existing = await db.syncFailures.get(key);
	// A fresh edit to the row is a new attempt at a new problem — don't make the
	// user wait out a backoff earned by the version they just replaced.
	const attempts = existing && existing.failedUpdatedAt === updatedAt ? existing.attempts + 1 : 1;
	const nextAttemptAt =
		attempts >= MAX_ATTEMPTS ? FOREVER : new Date(Date.parse(now) + backoffMs(attempts)).toISOString();
	await db.syncFailures.put({
		key,
		table,
		rowId,
		failedUpdatedAt: updatedAt,
		attempts,
		nextAttemptAt,
		code: error.code ?? null,
		message: error.message
	});
}

export async function clearFailure(table: string, rowId: string): Promise<void> {
	await db.syncFailures.delete(failureKey(table, rowId));
}

export async function clearFailures(table: string, rowIds: string[]): Promise<void> {
	if (!rowIds.length) return;
	await db.syncFailures.bulkDelete(rowIds.map((id) => failureKey(table, id)));
}

/** Every quarantine key, expired ones included. */
export async function allFailureKeys(): Promise<Set<string>> {
	return new Set((await db.syncFailures.toArray()).map((f) => f.key));
}

/**
 * Drop quarantines whose row has since been edited, or whose row is gone. Called
 * before every push so a user who fixes the problem is not left waiting.
 */
export async function reconcileFailures(
	current: { table: string; id: string; updatedAt: string }[]
): Promise<void> {
	const live = new Map(current.map((r) => [failureKey(r.table, r.id), r.updatedAt]));
	const stale = (await db.syncFailures.toArray()).filter((f) => {
		const updatedAt = live.get(f.key);
		return updatedAt === undefined || updatedAt !== f.failedUpdatedAt;
	});
	if (stale.length) await db.syncFailures.bulkDelete(stale.map((f) => f.key));
}

// ---------- whole-table quarantine (missing column) ----------

/**
 * Short TTL rather than "forever": the fix is for the maintainer to apply a
 * migration, and nobody should have to wait out a 24h backoff afterwards.
 */
const SCHEMA_BLOCK_MS = 10 * MINUTE;
const schemaBlockKey = (table: string) => `schema-block:${table}`;

export async function blockTable(
	table: string,
	error: PushError,
	now: string = new Date().toISOString()
): Promise<void> {
	await db.meta.put({
		key: schemaBlockKey(table),
		value: JSON.stringify({
			until: new Date(Date.parse(now) + SCHEMA_BLOCK_MS).toISOString(),
			message: error.message
		})
	});
}

/** The blocking message while a table is quarantined, otherwise null. */
export async function schemaBlockReason(
	table: string,
	now: string = new Date().toISOString()
): Promise<string | null> {
	const row = await db.meta.get(schemaBlockKey(table));
	if (!row) return null;
	try {
		const { until, message } = JSON.parse(row.value) as { until: string; message: string };
		if (until <= now) {
			await db.meta.delete(schemaBlockKey(table));
			return null;
		}
		return message;
	} catch {
		await db.meta.delete(schemaBlockKey(table));
		return null;
	}
}

/** User-facing "try again now". */
export async function retryAllNow(): Promise<void> {
	await db.syncFailures.clear();
	const blocks = await db.meta.where('key').startsWith('schema-block:').toArray();
	if (blocks.length) await db.meta.bulkDelete(blocks.map((b) => b.key));
}

export async function listFailures(): Promise<SyncFailure[]> {
	return db.syncFailures.orderBy('key').toArray();
}

export async function countFailures(): Promise<number> {
	return db.syncFailures.count();
}
