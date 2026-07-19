import { db } from '$lib/db/schema';
import type { Collection, RemoteShare, ShareGrant, ShareRole, UUID } from '$lib/db/types';
import { supabase } from './supabase';
import { auth } from './auth.svelte';

export const myUserId = (): string | null => auth.session?.user.id ?? null;
export const myEmail = (): string | null => auth.session?.user.email?.toLowerCase() ?? null;

const ROLE_RANK: Record<ShareRole, number> = { read: 1, write: 2, owner: 3 };

type ShareRow = Record<string, unknown>;

const toRemoteShare = (row: ShareRow): RemoteShare => ({
	id: String(row.id),
	collectionId: String(row.collection_id),
	ownerId: String(row.owner_id),
	granteeEmail: String(row.grantee_email),
	role: row.role as ShareRole,
	createdAt: String(row.created_at)
});

// ---------- share management (owner side, online only) ----------

export async function listShares(collectionId: UUID): Promise<RemoteShare[]> {
	if (!supabase) return [];
	const { data, error } = await supabase
		.from('collection_shares')
		.select('*')
		.eq('collection_id', collectionId)
		.is('deleted_at', null)
		.order('created_at', { ascending: true });
	if (error) throw new Error(error.message);
	return (data ?? []).map(toRemoteShare);
}

export async function addShare(
	collectionId: UUID,
	email: string,
	role: ShareRole
): Promise<void> {
	if (!supabase) throw new Error('Sync is not configured');
	const grantee = email.trim().toLowerCase();
	if (!grantee) throw new Error('Enter an email address');
	if (grantee === myEmail()) throw new Error('That is your own account');
	// upsert so re-inviting a previously revoked email resurrects the share
	const { error } = await supabase.from('collection_shares').upsert(
		{
			collection_id: collectionId,
			grantee_email: grantee,
			role,
			updated_at: new Date().toISOString(),
			deleted_at: null
		},
		{ onConflict: 'collection_id,grantee_email' }
	);
	if (error) throw new Error(error.message);
}

export async function setShareRole(shareId: UUID, role: ShareRole): Promise<void> {
	if (!supabase) throw new Error('Sync is not configured');
	const { error } = await supabase
		.from('collection_shares')
		.update({ role, updated_at: new Date().toISOString() })
		.eq('id', shareId);
	if (error) throw new Error(error.message);
}

/** Soft delete so the revocation syncs to the grantee, who then purges locally. */
export async function removeShare(shareId: UUID): Promise<void> {
	if (!supabase) throw new Error('Sync is not configured');
	const { error } = await supabase
		.from('collection_shares')
		.update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
		.eq('id', shareId);
	if (error) throw new Error(error.message);
}

/** Grantee walks away from a collection that was shared with them. */
export async function leaveShare(collectionId: UUID): Promise<void> {
	if (!supabase) throw new Error('Sync is not configured');
	const email = myEmail();
	if (!email) throw new Error('Not signed in');
	const { error } = await supabase
		.from('collection_shares')
		.delete()
		.eq('collection_id', collectionId)
		.eq('grantee_email', email);
	if (error) throw new Error(error.message);
	// drop the local copy right away instead of waiting for the next sync
	await db.shares.delete(collectionId);
	await purgeRevokedShares();
}

// ---------- grants cache (grantee side, refreshed by the sync engine) ----------

/** Rebuild the local cache of shares that target me. */
export async function refreshShareGrants(): Promise<void> {
	if (!supabase) return;
	const email = myEmail();
	const userId = myUserId();
	if (!email || !userId) return;
	const { data, error } = await supabase.from('collection_shares').select('*');
	if (error) throw new Error(`pull collection_shares: ${error.message}`);
	const grants: ShareGrant[] = (data ?? [])
		.filter(
			(row) =>
				!row.deleted_at &&
				String(row.grantee_email).toLowerCase() === email &&
				String(row.owner_id) !== userId
		)
		.map((row) => ({
			collectionId: String(row.collection_id),
			role: row.role as ShareRole,
			ownerId: String(row.owner_id),
			ownerEmail: null
		}));
	await db.transaction('rw', db.shares, async () => {
		await db.shares.clear();
		if (grants.length) await db.shares.bulkPut(grants);
	});
}

// ---------- role resolution (pure, works offline off the local cache) ----------

/**
 * Effective role on a collection: walk up the folder chain; my own
 * collections (ownerId missing or mine) are always 'owner', otherwise the
 * strongest share grant found on the chain wins.
 */
export function effectiveRole(
	collections: Collection[],
	grants: ShareGrant[],
	userId: string | null,
	collectionId: UUID
): ShareRole | null {
	const byId = new Map(collections.map((c) => [c.id, c]));
	const grantByCollection = new Map(grants.map((g) => [g.collectionId, g.role]));
	let best: ShareRole | null = null;
	const seen = new Set<UUID>();
	let cur = byId.get(collectionId);
	while (cur && !seen.has(cur.id)) {
		seen.add(cur.id);
		if (cur.ownerId == null || cur.ownerId === userId) return 'owner';
		const granted = grantByCollection.get(cur.id);
		if (granted && (!best || ROLE_RANK[granted] > ROLE_RANK[best])) best = granted;
		cur = cur.parentId ? byId.get(cur.parentId) : undefined;
	}
	return best;
}

/**
 * Drop local copies of foreign collections I no longer have access to
 * (share revoked or left). Hard delete without dirty flags — these were
 * never mine to tombstone.
 */
export async function purgeRevokedShares(): Promise<void> {
	const userId = myUserId();
	if (!userId) return;
	const [collections, grants] = await Promise.all([
		db.collections.toArray(),
		db.shares.toArray()
	]);
	const revoked = collections.filter(
		(c) =>
			c.ownerId != null &&
			c.ownerId !== userId &&
			effectiveRole(collections, grants, userId, c.id) === null
	);
	if (!revoked.length) return;
	const collectionIds = revoked.map((c) => c.id);
	await db.transaction('rw', [db.collections, db.items, db.photos, db.embeddings], async () => {
		const items = await db.items.where('collectionId').anyOf(collectionIds).toArray();
		const itemIds = items.map((i) => i.id);
		await db.photos.where('itemId').anyOf(itemIds).delete();
		await db.embeddings.where('itemId').anyOf(itemIds).delete();
		await db.items.where('collectionId').anyOf(collectionIds).delete();
		await db.collections.where('id').anyOf(collectionIds).delete();
	});
}
