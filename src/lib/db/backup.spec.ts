import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './schema';
import { buildBackup, importBackup, parseBackup, ImportError } from './backup';
import type { BackupPayload } from './backup';
import { createCollection, createItem } from './repo';

beforeEach(async () => {
	await Promise.all(db.tables.map((t) => t.clear()));
});

/** A payload shaped like a real export, with `overrides` spliced into the item. */
function payloadWithItem(overrides: Record<string, unknown>): BackupPayload {
	return {
		exportedAt: '2026-01-01T00:00:00.000Z',
		collections: [],
		items: [
			{
				id: 'i1',
				collectionId: 'c1',
				updatedAt: '2026-01-01T00:00:00.000Z',
				...overrides
			}
		] as BackupPayload['items'],
		photos: []
	};
}

describe('parseBackup', () => {
	it('rejects a file that carries neither collections nor items', () => {
		expect(() => parseBackup('{"photos":[]}')).toThrow(ImportError);
	});

	it('rejects text that is not JSON', () => {
		expect(() => parseBackup('not json')).toThrow(ImportError);
	});
});

describe('importBackup', () => {
	it('round-trips an export without changing it', async () => {
		const collection = await createCollection({ name: 'Cards' });
		await createItem({ collectionId: collection.id, name: 'Vader', tags: ['rare'] });
		const backup = await buildBackup();

		await Promise.all(db.tables.map((t) => t.clear()));
		const result = await importBackup(backup);

		expect(result.items.applied).toBe(1);
		const [item] = await db.items.toArray();
		expect(item.name).toBe('Vader');
		expect(item.tags).toEqual(['rare']);
	});

	it('keeps a fresher local record when the backup is older', async () => {
		const collection = await createCollection({ name: 'Cards' });
		const item = await createItem({ collectionId: collection.id, name: 'New name' });
		const result = await importBackup(
			payloadWithItem({
				id: item.id,
				collectionId: collection.id,
				name: 'Stale name',
				updatedAt: '2000-01-01T00:00:00.000Z'
			})
		);

		expect(result.items.skipped).toBe(1);
		expect((await db.items.get(item.id))!.name).toBe('New name');
	});

	// Records used to be written verbatim, so one malformed field from a
	// hand-edited or foreign file made every screen doing `item.tags.some(...)`
	// throw — an unopenable collection with no way back short of clearing storage.
	it('coerces malformed fields to the shapes the app guarantees', async () => {
		await importBackup(
			payloadWithItem({
				name: 42,
				tags: 'rare',
				quantity: 'lots',
				status: 'hoarded',
				customFields: ['nope'],
				acquisitionPrice: 'free'
			})
		);

		const item = (await db.items.get('i1'))!;
		expect(item.name).toBe('');
		expect(item.tags).toEqual([]);
		expect(item.quantity).toBe(1);
		expect(item.status).toBe('owned');
		expect(item.customFields).toEqual({});
		expect(item.acquisitionPrice).toBeNull();
	});

	it('skips records that cannot be placed at all', async () => {
		const result = await importBackup({
			exportedAt: '',
			collections: [],
			items: [
				{ collectionId: 'c1', updatedAt: '2026-01-01T00:00:00.000Z' }, // no id
				{ id: 'i2', updatedAt: '2026-01-01T00:00:00.000Z' } // no collection
			] as unknown as BackupPayload['items'],
			photos: []
		});

		expect(result.items.applied).toBe(0);
		expect(result.items.skipped).toBe(2);
		expect(await db.items.count()).toBe(0);
	});

	it('marks imported rows dirty so they reach the cloud', async () => {
		await importBackup(payloadWithItem({ name: 'Vader' }));
		expect((await db.items.get('i1'))!.dirty).toBe(1);
	});
});
