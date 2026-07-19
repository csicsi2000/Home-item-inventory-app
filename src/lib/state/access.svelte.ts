import { db } from '$lib/db/schema';
import type { ShareGrant, ShareRole, UUID } from '$lib/db/types';
import { effectiveRole, myUserId } from '$lib/sync/shares';
import { collectionsLive } from './collections.svelte';
import { Live } from './live.svelte';

/** Shares granted to me, live from the local cache (synced by the engine). */
export const shareGrantsLive = new Live<ShareGrant[]>(() => db.shares.toArray(), []);

/** Effective role on a collection, reactive to collections + grants. */
export function collectionRole(collectionId: UUID): ShareRole | null {
	return effectiveRole(
		collectionsLive.current,
		shareGrantsLive.current,
		myUserId(),
		collectionId
	);
}

export const canWrite = (role: ShareRole | null): boolean =>
	role === 'write' || role === 'owner';
