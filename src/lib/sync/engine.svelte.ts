import { db } from '$lib/db/schema';
import { onItemsChanged, purgeTombstones } from '$lib/db/repo';
import { supabase, syncConfigured } from './supabase';
import { auth } from './auth.svelte';
import { hydrateMissingPhotos, removeDeletedPhotoObjects, uploadPendingPhotos } from './imageQueue';
import { purgeRevokedShares, refreshShareGrants } from './shares';
import { TABLES, type DirtyRow, type RemoteRow, type TableSync } from './mapping';
import { advanceCursor, keysetFilter, readCursor, sameCursor, type PullCursor } from './cursor';
import {
	TransientSyncError,
	activeFailureKeys,
	allFailureKeys,
	blockTable,
	classifyPushError,
	clearFailures,
	countFailures,
	failureKey,
	recordFailure,
	reconcileFailures,
	retryAllNow,
	schemaBlockReason,
	type PushError
} from './failures';
import { assertAccount } from './reset';

const PUSH_CHUNK = 400;
const PULL_PAGE = 1000;

class SyncStatus {
	state = $state<'disabled' | 'signed-out' | 'idle' | 'syncing' | 'error' | 'offline'>(
		syncConfigured ? 'signed-out' : 'disabled'
	);
	lastSyncAt = $state<string | null>(null);
	error = $state<string | null>(null);
	pendingChanges = $state(0);
	/** Sync works, but some feature is unavailable server-side (e.g. sharing). */
	degraded = $state<string | null>(null);
	/** Rows the server permanently refused; they no longer block the queue. */
	blockedChanges = $state(0);
	blockedReason = $state<string | null>(null);
}

export const syncStatus = new SyncStatus();

// ---------- transports (injectable so the algorithms are testable) ----------

export type FetchPage = (
	table: string,
	cursor: PullCursor,
	limit: number
) => Promise<RemoteRow[]>;

/** Resolves to the server's complaint, or null on success — never throws. */
export type UpsertRows = (table: string, rows: RemoteRow[]) => Promise<PushError | null>;

const supabaseFetchPage: FetchPage = async (table, cursor, limit) => {
	const { data, error } = await supabase!
		.from(table)
		.select('*')
		.or(keysetFilter(cursor))
		.order('server_updated_at', { ascending: true })
		.order('id', { ascending: true })
		.limit(limit);
	if (error) throw new Error(`pull ${table}: ${error.message}`);
	return (data ?? []) as RemoteRow[];
};

const supabaseUpsert: UpsertRows = async (table, rows) => {
	const { error, status } = await supabase!.from(table).upsert(rows, { onConflict: 'id' });
	if (!error) return null;
	return { code: error.code, message: error.message, status };
};

// ---------- push ----------

/**
 * Mark rows as pushed. A row that succeeds also leaves quarantine — otherwise an
 * expired-then-successful retry would keep warning the user forever.
 */
async function commit(
	table: TableSync,
	rows: DirtyRow[],
	quarantined: Set<string>
): Promise<void> {
	for (const entry of rows) await table.clearDirty(entry.id, entry.updatedAt);
	if (!quarantined.size) return;
	await clearFailures(
		table.remote,
		rows.map((r) => r.id).filter((id) => quarantined.has(failureKey(table.remote, id)))
	);
}

/**
 * Narrow a rejected chunk down to the rows the server actually objects to, by
 * halving. O(k·log n) requests for k bad rows instead of n.
 *
 * Halves keep their relative order, so `collections` stays parents-first. A child
 * that ends up isolated from its parent fails its own RLS parent check, gets
 * quarantined, and succeeds on the next sync once the parent has landed.
 */
async function bisectPush(
	table: TableSync,
	chunk: DirtyRow[],
	upsert: UpsertRows,
	now: string,
	quarantined: Set<string>
): Promise<number> {
	if (!chunk.length) return 0;

	if (chunk.length === 1) {
		const [entry] = chunk;
		const error = await upsert(table.remote, [entry.row]);
		if (!error) {
			await commit(table, chunk, quarantined);
			return 1;
		}
		if (classifyPushError(error) === 'transient') {
			throw new TransientSyncError(`push ${table.remote}: ${error.message}`);
		}
		await recordFailure(table.remote, entry.id, entry.updatedAt, error, now);
		return 0;
	}

	const mid = Math.ceil(chunk.length / 2);
	let pushed = 0;
	for (const half of [chunk.slice(0, mid), chunk.slice(mid)]) {
		const error = await upsert(
			table.remote,
			half.map((c) => c.row)
		);
		if (!error) {
			await commit(table, half, quarantined);
			pushed += half.length;
			continue;
		}
		const kind = classifyPushError(error);
		if (kind === 'transient') {
			throw new TransientSyncError(`push ${table.remote}: ${error.message}`);
		}
		if (kind === 'schema') {
			await blockTable(table.remote, error, now);
			break;
		}
		pushed += await bisectPush(table, half, upsert, now, quarantined);
	}
	return pushed;
}

export async function push(upsert: UpsertRows = supabaseUpsert): Promise<number> {
	const now = new Date().toISOString();

	const perTable = new Map<string, DirtyRow[]>();
	for (const table of TABLES) perTable.set(table.remote, await table.dirtyRows());

	// a row edited since it was quarantined is a new attempt at a new problem
	await reconcileFailures(
		[...perTable].flatMap(([remote, rows]) =>
			rows.map((r) => ({ table: remote, id: r.id, updatedAt: r.updatedAt }))
		)
	);
	const blocked = await activeFailureKeys(now);
	const quarantined = await allFailureKeys();

	let pushed = 0;
	for (const table of TABLES) {
		if (await schemaBlockReason(table.remote, now)) continue;
		const dirty = perTable
			.get(table.remote)!
			.filter((r) => !blocked.has(failureKey(table.remote, r.id)));

		for (let offset = 0; offset < dirty.length; offset += PUSH_CHUNK) {
			const chunk = dirty.slice(offset, offset + PUSH_CHUNK);
			const error = await upsert(
				table.remote,
				chunk.map((c) => c.row)
			);
			if (!error) {
				await commit(table, chunk, quarantined);
				pushed += chunk.length;
				continue;
			}
			const kind = classifyPushError(error);
			if (kind === 'transient') {
				throw new TransientSyncError(`push ${table.remote}: ${error.message}`);
			}
			if (kind === 'schema') {
				// every row of the table fails identically — don't bisect 400 rows to
				// rediscover that on each one
				await blockTable(table.remote, error, now);
				break;
			}
			pushed += await bisectPush(table, chunk, upsert, now, quarantined);
		}
	}
	return pushed;
}

async function pullTable(
	table: TableSync,
	fetchPage: FetchPage,
	pageSize: number
): Promise<number> {
	let cursor = readCursor(await db.syncState.get(table.remote));
	let applied = 0;
	for (;;) {
		const rows = await fetchPage(table.remote, cursor, pageSize);
		if (!rows.length) break;
		for (const row of rows) await table.applyRemote(row);
		applied += rows.length;

		const next = advanceCursor(rows, cursor);
		// A page that can't move the cursor (rows with no server_updated_at, e.g.
		// a table whose trigger is missing) would otherwise loop forever.
		if (sameCursor(next, cursor)) break;
		cursor = next;
		await db.syncState.put({
			table: table.remote,
			lastPulledAt: cursor.ts,
			lastPulledId: cursor.id
		});
		// Keyset paging guarantees forward progress, so an empty page is the only
		// termination signal we need — and unlike `rows.length < pageSize` it stays
		// correct when the server caps rows below our requested limit.
	}
	return applied;
}

export async function pull(
	fetchPage: FetchPage = supabaseFetchPage,
	pageSize: number = PULL_PAGE
): Promise<number> {
	let applied = 0;
	for (const table of TABLES) applied += await pullTable(table, fetchPage, pageSize);
	return applied;
}

const REMOTE_CURSOR_KEY = '_remote_cursor';

/**
 * One cheap RPC that answers "did anything visible to me change?".
 * Null when the migration isn't applied yet → callers fall back to pulling.
 *
 * The raw string is returned deliberately: re-formatting it through Date would
 * truncate Postgres microseconds, and a truncated-down cursor compares as
 * "unchanged" against a write that landed in the same millisecond.
 */
async function fetchRemoteCursor(): Promise<string | null> {
	try {
		const { data, error } = await supabase!.rpc('sync_cursor');
		if (error || !data) return null;
		return String(data);
	} catch {
		return null;
	}
}

/** Whichever table-wide block is in force, for the badge. */
async function firstBlockedReason(): Promise<string | null> {
	const now = new Date().toISOString();
	for (const table of TABLES) {
		const reason = await schemaBlockReason(table.remote, now);
		if (reason) return `${table.remote}: ${reason}`;
	}
	return null;
}

async function countPending(): Promise<number> {
	let total = 0;
	for (const table of [db.collections, db.items, db.photos] as const) {
		total += await table.where('dirty').equals(1).count();
	}
	return total;
}

// ---------- orchestration ----------

let syncing = false;
let queued = false;

/** Signals that the signed-in user changed mid-run; not an error to report. */
class SyncAborted extends Error {
	constructor() {
		super('sync aborted: account changed');
		this.name = 'SyncAborted';
	}
}

export async function syncNow(): Promise<void> {
	if (!supabase || !auth.session) return;
	if (syncing) {
		queued = true;
		return;
	}
	syncing = true;
	syncStatus.state = 'syncing';
	syncStatus.error = null;
	try {
		const userId = auth.session.user.id;
		// a sign-out or account switch part-way through a six-stage run would
		// otherwise surface as a raw "JWT expired" from whichever stage was in flight
		const stillSameUser = () => {
			if (auth.userId !== userId) throw new SyncAborted();
		};

		// must run before anything uploads: never push one account's data under
		// another account's JWT
		if (await assertAccount(userId)) {
			console.info('signed in as a different account — cleared the previous local copy');
		}
		stillSameUser();

		await uploadPendingPhotos(userId);
		stillSameUser();
		await push();
		stillSameUser();
		// after push, never before: removing a storage object while its tombstone
		// is still local leaves other devices pointing at nothing
		await removeDeletedPhotoObjects();
		stillSameUser();

		// change detection: when the server-side max cursor hasn't moved since
		// the last pull, skip pulling every table (and the photo scans) entirely
		const remoteCursor = await fetchRemoteCursor();
		const lastSeen = (await db.syncState.get(REMOTE_CURSOR_KEY))?.lastPulledAt;
		const unchanged = remoteCursor !== null && lastSeen !== undefined && remoteCursor <= lastSeen;

		if (!unchanged) {
			await pull();
			stillSameUser();
			const sharingAvailable = await refreshShareGrants();
			syncStatus.degraded = sharingAvailable
				? null
				: 'Sharing is unavailable — the Supabase schema needs updating.';
			if (sharingAvailable) await purgeRevokedShares();
			// drain the download backlog in bounded batches
			let hydrated = 0;
			for (;;) {
				const batch = await hydrateMissingPhotos();
				hydrated += batch;
				if (batch < 30) break;
			}
			if (hydrated > 0) {
				// newly arrived photos may need fingerprints for duplicate detection
				void import('$lib/ml/embeddingStage').then((m) => m.scheduleBackfill?.());
			}
			await purgeTombstones();
			if (remoteCursor) {
				await db.syncState.put({ table: REMOTE_CURSOR_KEY, lastPulledAt: remoteCursor });
			}
		}
		syncStatus.state = 'idle';
		syncStatus.lastSyncAt = new Date().toISOString();
	} catch (err) {
		if (err instanceof SyncAborted) {
			syncStatus.state = auth.session ? 'idle' : 'signed-out';
		} else {
			console.warn('sync failed', err);
			syncStatus.state = navigator.onLine === false ? 'offline' : 'error';
			syncStatus.error = err instanceof Error ? err.message : String(err);
		}
	} finally {
		syncStatus.pendingChanges = await countPending().catch(() => 0);
		syncStatus.blockedChanges = await countFailures().catch(() => 0);
		syncStatus.blockedReason = await firstBlockedReason().catch(() => null);
		syncing = false;
		if (queued) {
			queued = false;
			void syncNow();
		}
	}
}

/** Lift every quarantine and try again right away. */
export async function retryBlocked(): Promise<void> {
	await retryAllNow();
	syncStatus.blockedChanges = 0;
	syncStatus.blockedReason = null;
	await syncNow();
}

let started = false;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

/** Returns a teardown; call it when the app shell unmounts. */
export function startSyncEngine(): () => void {
	if (started || !syncConfigured || typeof window === 'undefined') return () => {};
	started = true;

	// keep the pending-changes badge fresh + push soon after local writes
	const unsubscribeItems = onItemsChanged(() => {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => void syncNow(), 5000);
		void countPending().then((n) => (syncStatus.pendingChanges = n));
	});

	const onOnline = () => void syncNow();
	window.addEventListener('online', onOnline);

	const interval = setInterval(
		() => {
			if (!document.hidden) void syncNow();
		},
		5 * 60_000
	);

	void countPending().then((n) => (syncStatus.pendingChanges = n));

	// first sync as soon as we know who's signed in. Depends on auth.userId, not
	// auth.session, so an hourly token refresh doesn't trigger a full sync.
	const disposeEffect = $effect.root(() => {
		$effect(() => {
			if (auth.userId) {
				syncStatus.state = 'syncing';
				void syncNow();
			} else if (auth.ready) {
				syncStatus.state = 'signed-out';
			}
		});
	});

	return () => {
		unsubscribeItems();
		window.removeEventListener('online', onOnline);
		clearInterval(interval);
		clearTimeout(debounceTimer);
		disposeEffect();
		started = false;
	};
}
