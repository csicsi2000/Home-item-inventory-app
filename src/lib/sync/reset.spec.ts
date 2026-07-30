import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '$lib/db/schema';
import { addPhoto, createCollection, createItem } from '$lib/db/repo';
import { assertAccount, clearSyncedData, currentAccount } from './reset';

vi.mock('./supabase', () => ({ supabase: null, syncConfigured: false }));

beforeEach(async () => {
	await Promise.all(db.tables.map((t) => t.clear()));
	localStorage.clear();
});

const image = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'image/webp' });

async function seedAccountData() {
	const collection = await createCollection({ name: 'Cards' });
	const item = await createItem({ collectionId: collection.id, name: 'Card' });
	await addPhoto(item.id, { blob: image(), thumb: image(), width: 10, height: 10 });
	await db.embeddings.put({
		itemId: item.id,
		phash: 'abcdef0123456789',
		vector: new Float32Array([1, 0]),
		updatedAt: '2026-01-01T00:00:00.000Z',
		dirty: 0
	});
	await db.shares.put({ collectionId: collection.id, role: 'read', ownerId: 'a', ownerEmail: null });
	await db.syncState.put({ table: 'items', lastPulledAt: '2026-01-01T00:00:00Z', lastPulledId: 'x' });
	await db.syncFailures.put({
		key: 'items:x',
		table: 'items',
		rowId: 'x',
		failedUpdatedAt: '2026-01-01T00:00:00.000Z',
		attempts: 1,
		nextAttemptAt: '2027-01-01T00:00:00.000Z',
		code: '42501',
		message: 'nope'
	});
	await db.mlJobs.put({
		id: 'photo-1',
		itemId: item.id,
		remaining: ['ocr'],
		status: 'pending',
		attempts: 0,
		nextAttemptAt: '2026-01-01T00:00:00.000Z',
		lastError: null,
		createdAt: '2026-01-01T00:00:00.000Z'
	});
}

const accountRowCounts = async () => ({
	collections: await db.collections.count(),
	items: await db.items.count(),
	photos: await db.photos.count(),
	embeddings: await db.embeddings.count(),
	shares: await db.shares.count(),
	syncState: await db.syncState.count(),
	syncFailures: await db.syncFailures.count(),
	mlJobs: await db.mlJobs.count()
});

describe('clearSyncedData', () => {
	it('removes every trace of the account, cursors included', async () => {
		await seedAccountData();

		await clearSyncedData();

		expect(await accountRowCounts()).toEqual({
			collections: 0,
			items: 0,
			photos: 0,
			embeddings: 0,
			shares: 0,
			syncState: 0,
			syncFailures: 0,
			mlJobs: 0
		});
	});

	it('leaves device preferences alone', async () => {
		localStorage.setItem('ccs-settings', '{"autoOcr":false}');
		await seedAccountData();

		await clearSyncedData();

		expect(localStorage.getItem('ccs-settings')).toBe('{"autoOcr":false}');
	});
});

describe('assertAccount', () => {
	it('does not wipe on a local-only user first signing in', async () => {
		await seedAccountData();

		const switched = await assertAccount('user-a');

		expect(switched).toBe(false);
		// their existing local data is theirs to upload
		expect(await db.items.count()).toBe(1);
		expect(await currentAccount()).toBe('user-a');
	});

	it('does not wipe when the same account syncs again', async () => {
		await assertAccount('user-a');
		await seedAccountData();
		const before = await accountRowCounts();

		const switched = await assertAccount('user-a');

		expect(switched).toBe(false);
		expect(await accountRowCounts()).toEqual(before);
	});

	it('wipes when a different account signs in on the same device', async () => {
		await assertAccount('user-a');
		await seedAccountData();

		const switched = await assertAccount('user-b');

		expect(switched).toBe(true);
		expect(await db.items.count()).toBe(0);
		expect(await currentAccount()).toBe('user-b');
	});

	it('clears the pull cursors so the new account pulls its full history', async () => {
		// the original bug: user B inherited A's cursor and never pulled any row
		// older than it, silently seeing a partial collection
		await assertAccount('user-a');
		await db.syncState.put({ table: 'items', lastPulledAt: '2026-06-01T00:00:00Z', lastPulledId: 'z' });

		await assertAccount('user-b');

		expect(await db.syncState.get('items')).toBeUndefined();
	});

	it('is idempotent across repeated syncs after a switch', async () => {
		await assertAccount('user-a');
		await assertAccount('user-b');
		await seedAccountData();

		expect(await assertAccount('user-b')).toBe(false);
		expect(await db.items.count()).toBe(1);
	});
});
