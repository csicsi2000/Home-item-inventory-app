import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/schema';
import type { PullCursor } from './cursor';
import { itemsSync, type RemoteRow } from './mapping';
import { pull, type FetchPage } from './engine.svelte';

vi.mock('./supabase', () => ({ supabase: null, syncConfigured: false }));

beforeEach(async () => {
	await Promise.all(db.tables.map((t) => t.clear()));
});

const remoteItem = (id: string, ts: string): RemoteRow => ({
	id,
	user_id: 'user-1',
	collection_id: 'col-1',
	name: `Item ${id}`,
	description: null,
	quantity: 1,
	status: 'owned',
	condition: null,
	tags: [],
	barcode: null,
	ocr_text: null,
	acquisition_price: null,
	acquisition_date: null,
	sold_price: null,
	sold_date: null,
	currency: null,
	custom_fields: {},
	created_at: '2026-01-01T00:00:00.000Z',
	updated_at: '2026-01-01T00:00:00.000Z',
	deleted_at: null,
	server_updated_at: ts
});

/**
 * A fake PostgREST implementing real keyset semantics: total order on
 * (server_updated_at, id), strictly-after filtering, hard page limit.
 */
function fakeServer(rows: RemoteRow[]) {
	const sorted = [...rows].sort((a, b) => {
		const ts = String(a.server_updated_at).localeCompare(String(b.server_updated_at));
		return ts !== 0 ? ts : String(a.id).localeCompare(String(b.id));
	});
	const calls: { table: string; cursor: PullCursor }[] = [];

	const fetchPage: FetchPage = async (table, cursor, limit) => {
		calls.push({ table, cursor: { ...cursor } });
		if (table !== 'items') return [];
		const after = sorted.filter((r) => {
			const ts = String(r.server_updated_at);
			if (ts > cursor.ts) return true;
			return cursor.id !== null && ts === cursor.ts && String(r.id) > cursor.id;
		});
		return after.slice(0, limit);
	};

	return { fetchPage, calls, sorted };
}

const padded = (n: number) => String(n).padStart(4, '0');

describe('pull pagination', () => {
	// The bug this replaces: touch_server_updated_at() stamps now(), the
	// TRANSACTION timestamp, so a bulk write gives hundreds of rows an identical
	// server_updated_at. A cursor of `.gt(lastRowTimestamp)` then jumps past the
	// rest of that group, and because the cursor only moves forward those rows
	// are never pulled again. Against the old implementation this test applies 30
	// of 300 rows.
	it('applies every row when hundreds share one server_updated_at', async () => {
		const timestamps = [
			'2026-01-01 10:00:00.000001+00',
			'2026-01-01 10:00:00.000002+00',
			'2026-01-01 10:00:00.000003+00'
		];
		const rows = Array.from({ length: 300 }, (_, i) =>
			remoteItem(`item-${padded(i)}`, timestamps[Math.floor(i / 100)])
		);
		const { fetchPage } = fakeServer(rows);

		const applied = await pull(fetchPage, 10);

		expect(applied).toBe(300);
		expect(await db.items.count()).toBe(300);
	});

	it('drains a single-timestamp group larger than one page', async () => {
		const rows = Array.from({ length: 25 }, (_, i) =>
			remoteItem(`item-${padded(i)}`, '2026-01-01 10:00:00.000000+00')
		);
		const { fetchPage } = fakeServer(rows);

		await pull(fetchPage, 10);

		expect(await db.items.count()).toBe(25);
	});

	it('stores the composite cursor so the next run resumes mid-group', async () => {
		const rows = Array.from({ length: 5 }, (_, i) => remoteItem(`item-${padded(i)}`, 'same-ts'));
		const { fetchPage } = fakeServer(rows);

		await pull(fetchPage, 10);

		expect(await db.syncState.get('items')).toMatchObject({
			lastPulledAt: 'same-ts',
			lastPulledId: 'item-0004'
		});
	});

	it('applies nothing on a re-run against an unchanged server', async () => {
		const rows = Array.from({ length: 12 }, (_, i) => remoteItem(`item-${padded(i)}`, 'ts-1'));
		const { fetchPage } = fakeServer(rows);
		await pull(fetchPage, 5);

		const applied = await pull(fetchPage, 5);

		expect(applied).toBe(0);
		expect(await db.items.count()).toBe(12);
	});

	it('loses no rows when a page fails part-way through and the pull is retried', async () => {
		const rows = Array.from({ length: 30 }, (_, i) => remoteItem(`item-${padded(i)}`, 'ts-1'));
		const { fetchPage } = fakeServer(rows);
		const real = itemsSync.applyRemote.bind(itemsSync);
		let seen = 0;
		const spy = vi.spyOn(itemsSync, 'applyRemote').mockImplementation(async (row) => {
			if (++seen === 15) throw new Error('IndexedDB blew up');
			await real(row);
		});

		await expect(pull(fetchPage, 10)).rejects.toThrow('IndexedDB blew up');
		spy.mockRestore();
		await pull(fetchPage, 10);

		// duplicates are fine (applyRemote is idempotent); gaps are not
		expect(await db.items.count()).toBe(30);
	});

	it('stops instead of looping when rows carry no server_updated_at', async () => {
		// a project whose touch trigger was never installed
		const rows = Array.from({ length: 3 }, (_, i) => {
			const row = remoteItem(`item-${padded(i)}`, 'unused');
			delete row.server_updated_at;
			return row;
		});
		const calls: number[] = [];
		const fetchPage: FetchPage = async (table) => {
			calls.push(1);
			return table === 'items' ? rows : [];
		};

		await pull(fetchPage, 10);

		// one call per table, no retry loop on the unusable page
		expect(calls).toHaveLength(3);
		expect(await db.items.count()).toBe(3);
	});

	it('keeps paging when the server returns fewer rows than requested', async () => {
		// a server-side max-rows cap below our page size used to end the pull early
		const rows = Array.from({ length: 20 }, (_, i) => remoteItem(`item-${padded(i)}`, `ts-${i}`));
		const { fetchPage } = fakeServer(rows);
		const capped: FetchPage = (table, cursor, limit) => fetchPage(table, cursor, Math.min(limit, 3));

		await pull(capped, 1000);

		expect(await db.items.count()).toBe(20);
	});

	it('starts every table from the epoch and advances each independently', async () => {
		const rows = [remoteItem('item-0001', 'ts-1')];
		const { fetchPage, calls } = fakeServer(rows);

		await pull(fetchPage, 10);

		expect(calls.filter((c) => c.table === 'collections')[0].cursor).toEqual({
			ts: '1970-01-01T00:00:00Z',
			id: null
		});
		expect(await db.syncState.get('collections')).toBeUndefined();
		expect(await db.syncState.get('items')).toMatchObject({ lastPulledId: 'item-0001' });
	});
});
