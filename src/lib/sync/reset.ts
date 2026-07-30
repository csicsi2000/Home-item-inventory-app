import { db } from '$lib/db/schema';
import { notifyItemsChanged } from '$lib/db/repo';
import { resetIndex } from '$lib/search';

const ACCOUNT_KEY = 'account';

/**
 * Wipe everything that belongs to a cloud account, leaving device preferences
 * (theme, recognition thresholds, dismissed hints — all localStorage) alone.
 *
 * Not called on sign-out: signing out is not a request to delete your work.
 */
export async function clearSyncedData(): Promise<void> {
	await db.transaction(
		'rw',
		[
			db.collections,
			db.items,
			db.photos,
			db.embeddings,
			db.shares,
			db.syncState,
			db.syncFailures,
			db.mlJobs
		],
		async () => {
			await Promise.all([
				db.collections.clear(),
				db.items.clear(),
				db.photos.clear(),
				db.embeddings.clear(),
				db.shares.clear(),
				db.syncState.clear(),
				db.syncFailures.clear(),
				db.mlJobs.clear()
			]);
		}
	);
	resetIndex();
	notifyItemsChanged([]);
}

/**
 * Guard the device against mixing two accounts' data.
 *
 * Without this, user B signing in where user A was signed in inherits A's
 * per-table pull cursors, so B never pulls any row older than A's cursor and
 * silently sees a partial collection — while A's collections stay on screen and,
 * once edited, push under B's JWT and get refused by RLS forever.
 *
 * A first sign-in with no recorded account is NOT a switch: a local-only user's
 * existing data is legitimately theirs to upload.
 */
export async function assertAccount(userId: string): Promise<boolean> {
	const previous = await db.meta.get(ACCOUNT_KEY);
	const switched = previous !== undefined && previous.value !== userId;
	if (switched) await clearSyncedData();
	if (previous?.value !== userId) await db.meta.put({ key: ACCOUNT_KEY, value: userId });
	return switched;
}

/** Which account last synced on this device, if any. */
export async function currentAccount(): Promise<string | null> {
	return (await db.meta.get(ACCOUNT_KEY))?.value ?? null;
}
