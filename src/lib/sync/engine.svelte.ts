import { db } from '$lib/db/schema';
import { onItemsChanged, purgeTombstones } from '$lib/db/repo';
import { supabase, syncConfigured } from './supabase';
import { auth } from './auth.svelte';
import { hydrateMissingPhotos, removeDeletedPhotoObjects, uploadPendingPhotos } from './imageQueue';
import { purgeRevokedShares, refreshShareGrants } from './shares';
import { TABLES, type DirtyRow, type RemoteRow, type TableSync } from './mapping';
import { advanceCursor, keysetFilter, readCursor, sameCursor, type PullCursor } from './cursor';

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
}

export const syncStatus = new SyncStatus();

// ---------- transports (injectable so the algorithms are testable) ----------

export type FetchPage = (
	table: string,
	cursor: PullCursor,
	limit: number
) => Promise<RemoteRow[]>;

export type UpsertRows = (table: string, rows: RemoteRow[]) => Promise<void>;

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
	const { error } = await supabase!.from(table).upsert(rows, { onConflict: 'id' });
	if (error) throw new Error(`push ${table}: ${error.message}`);
};

// ---------- push / pull ----------

export async function push(upsert: UpsertRows = supabaseUpsert): Promise<number> {
	let pushed = 0;
	for (const table of TABLES) {
		const dirty = await table.dirtyRows();
		for (let offset = 0; offset < dirty.length; offset += PUSH_CHUNK) {
			const chunk: DirtyRow[] = dirty.slice(offset, offset + PUSH_CHUNK);
			await upsert(
				table.remote,
				chunk.map((c) => c.row)
			);
			for (const entry of chunk) await table.clearDirty(entry.id, entry.updatedAt);
			pushed += chunk.length;
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
		await uploadPendingPhotos(auth.session.user.id);
		await removeDeletedPhotoObjects();
		await push();

		// change detection: when the server-side max cursor hasn't moved since
		// the last pull, skip pulling every table (and the photo scans) entirely
		const remoteCursor = await fetchRemoteCursor();
		const lastSeen = (await db.syncState.get(REMOTE_CURSOR_KEY))?.lastPulledAt;
		const unchanged = remoteCursor !== null && lastSeen !== undefined && remoteCursor <= lastSeen;

		if (!unchanged) {
			await pull();
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
		console.warn('sync failed', err);
		syncStatus.state = navigator.onLine === false ? 'offline' : 'error';
		syncStatus.error = err instanceof Error ? err.message : String(err);
	} finally {
		syncStatus.pendingChanges = await countPending().catch(() => 0);
		syncing = false;
		if (queued) {
			queued = false;
			void syncNow();
		}
	}
}

let started = false;
let debounceTimer: ReturnType<typeof setTimeout> | undefined;

export function startSyncEngine(): void {
	if (started || !syncConfigured || typeof window === 'undefined') return;
	started = true;

	// keep the pending-changes badge fresh + push soon after local writes
	onItemsChanged(() => {
		clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => void syncNow(), 5000);
		void countPending().then((n) => (syncStatus.pendingChanges = n));
	});

	window.addEventListener('online', () => void syncNow());
	setInterval(
		() => {
			if (!document.hidden) void syncNow();
		},
		5 * 60_000
	);

	void countPending().then((n) => (syncStatus.pendingChanges = n));

	// first sync as soon as we know who's signed in
	$effect.root(() => {
		$effect(() => {
			if (auth.session) {
				syncStatus.state = 'syncing';
				void syncNow();
			} else if (auth.ready) {
				syncStatus.state = 'signed-out';
			}
		});
	});
}
