import Dexie, { type EntityTable } from 'dexie';
import type { Collection, Item, ItemEmbedding, ItemPhoto, SyncState } from './types';

export class AppDatabase extends Dexie {
	collections!: EntityTable<Collection, 'id'>;
	items!: EntityTable<Item, 'id'>;
	photos!: EntityTable<ItemPhoto, 'id'>;
	embeddings!: EntityTable<ItemEmbedding, 'itemId'>;
	syncState!: EntityTable<SyncState, 'table'>;

	constructor(name = 'card-collection-scanner') {
		super(name);
		this.version(1).stores({
			collections: 'id, dirty, deletedAt',
			items: 'id, collectionId, dirty, barcode, status, *tags',
			photos: 'id, itemId, dirty, uploaded',
			embeddings: 'itemId, dirty',
			syncState: 'table'
		});
	}
}

export const db = new AppDatabase();
