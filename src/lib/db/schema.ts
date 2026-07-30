import Dexie, { type EntityTable } from 'dexie';
import type {
	Collection,
	Item,
	ItemEmbedding,
	ItemPhoto,
	MetaRow,
	MlJob,
	ShareGrant,
	SyncFailure,
	SyncState
} from './types';

export class AppDatabase extends Dexie {
	collections!: EntityTable<Collection, 'id'>;
	items!: EntityTable<Item, 'id'>;
	photos!: EntityTable<ItemPhoto, 'id'>;
	embeddings!: EntityTable<ItemEmbedding, 'itemId'>;
	syncState!: EntityTable<SyncState, 'table'>;
	shares!: EntityTable<ShareGrant, 'collectionId'>;
	syncFailures!: EntityTable<SyncFailure, 'key'>;
	mlJobs!: EntityTable<MlJob, 'id'>;
	meta!: EntityTable<MetaRow, 'key'>;

	constructor(name = 'card-collection-scanner') {
		super(name);
		this.version(1).stores({
			collections: 'id, dirty, deletedAt',
			items: 'id, collectionId, dirty, barcode, status, *tags',
			photos: 'id, itemId, dirty, uploaded',
			embeddings: 'itemId, dirty',
			syncState: 'table'
		});
		this.version(2).stores({
			shares: 'collectionId'
		});
		// v3 adds:
		//  * deletedAt / storagePath indexes on items + photos. IndexedDB refuses
		//    null keys, so these are SPARSE: `where('deletedAt').above('')` returns
		//    only tombstones. That replaces full-table filter() scans which
		//    deserialized every photo Blob on every sync.
		//  * syncFailures — push quarantine, so one permanently-rejected row can't
		//    wedge the whole sync.
		//  * mlJobs — durable recognition queue that survives a tab close.
		//  * meta — device bookkeeping (which account last synced here).
		this.version(3)
			.stores({
				items: 'id, collectionId, dirty, barcode, status, deletedAt, *tags',
				photos: 'id, itemId, dirty, uploaded, deletedAt, storagePath',
				syncFailures: 'key, table, nextAttemptAt',
				mlJobs: 'id, status, nextAttemptAt',
				meta: 'key'
			})
			.upgrade(async (tx) => {
				// Pull cursors written before keyset pagination may already have
				// skipped past same-timestamp rows that no forward-only cursor can
				// reach again. Reset to epoch for one full re-pull of metadata;
				// applyRemote is idempotent and photo Blobs are preserved by the
				// photo merge, so nothing re-downloads.
				await tx.table('syncState').clear();
			});
	}
}

export const db = new AppDatabase();
