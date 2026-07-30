<script lang="ts">
	import { base } from '$app/paths';
	import { db } from '$lib/db/schema';
	import { live } from '$lib/state/live.svelte';
	import { listDeletedItems, purgeTombstones, restoreItems } from '$lib/db/repo';
	import { collectionsLive } from '$lib/state/collections.svelte';
	import { canWrite, collectionRole } from '$lib/state/access.svelte';
	import { syncStatus } from '$lib/sync/engine.svelte';
	import { syncConfigured } from '$lib/sync/supabase';
	import type { Item } from '$lib/db/types';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import UndoIcon from '@lucide/svelte/icons/undo-2';
	import { toast } from 'svelte-sonner';

	// The retention window purgeTombstones() enforces. Shown so "30 days" isn't
	// folklore the user has to discover by losing something.
	const RETENTION_DAYS = 30;

	const deleted = $derived(live<Item[]>(() => listDeletedItems(), []));

	const names = $derived(
		Object.fromEntries(collectionsLive.current.map((c) => [c.id, c.name]))
	);

	/** Restoring into a collection you can no longer write to would fail on push. */
	const restorable = $derived(
		deleted.current.filter((i) => canWrite(collectionRole(i.collectionId)))
	);

	let confirmingEmpty = $state(false);
	let busy = $state(false);

	function daysLeft(deletedAt: string): number {
		const elapsed = Date.now() - Date.parse(deletedAt);
		return Math.max(0, RETENTION_DAYS - Math.floor(elapsed / 86_400_000));
	}

	async function restore(ids: string[]) {
		if (busy) return;
		busy = true;
		try {
			const n = await restoreItems(ids);
			toast.success(`Restored ${n} item${n === 1 ? '' : 's'}`);
		} catch (err) {
			console.error(err);
			toast.error('Could not restore');
		} finally {
			busy = false;
		}
	}

	async function emptyTrash() {
		confirmingEmpty = false;
		busy = true;
		try {
			// 0 days: purge everything already pushed. Rows still dirty stay put —
			// dropping them here would strand the tombstone on other devices, which
			// would then keep the item forever. The 60-day orphan grace is left alone
			// so photo rows outlive the item until their storage object is gone.
			const purged = await purgeTombstones(0, 60);
			const left = await db.items.where('deletedAt').above('').count();
			toast.success(
				`Emptied ${purged} record${purged === 1 ? '' : 's'}` +
					(left ? ` · ${left} waiting to sync first` : '')
			);
		} catch (err) {
			console.error(err);
			toast.error('Could not empty the trash');
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Recently deleted</title></svelte:head>

<div class="mx-auto max-w-3xl px-4 py-6 md:px-8">
	<div class="mb-4 flex items-center gap-3">
		<Button variant="ghost" size="icon" href="{base}/settings" aria-label="Back to settings">
			<ArrowLeftIcon class="size-5" />
		</Button>
		<div class="min-w-0 flex-1">
			<h1 class="truncate text-xl font-bold tracking-tight">Recently deleted</h1>
			<p class="text-xs text-muted-foreground">
				Deleted items are kept for {RETENTION_DAYS} days, then removed for good.
			</p>
		</div>
		{#if deleted.current.length}
			<Button
				variant="outline"
				size="sm"
				disabled={busy}
				onclick={() => (confirmingEmpty = true)}
			>
				<Trash2Icon class="size-4" />
				Empty
			</Button>
		{/if}
	</div>

	{#if !deleted.loaded}
		<div class="grid gap-2">
			{#each Array(4) as _, i (i)}
				<Skeleton class="h-16 w-full rounded-lg" />
			{/each}
		</div>
	{:else if deleted.current.length === 0}
		<div class="flex flex-col items-center gap-3 rounded-xl border border-dashed py-16 text-center">
			<Trash2Icon class="size-10 text-muted-foreground" />
			<div>
				<p class="font-medium">Nothing deleted</p>
				<p class="mt-1 text-sm text-muted-foreground">
					Items you delete land here first, so a mistake is never final.
				</p>
			</div>
		</div>
	{:else}
		{#if restorable.length > 1}
			<Button
				variant="secondary"
				size="sm"
				class="mb-3"
				disabled={busy}
				onclick={() => restore(restorable.map((i) => i.id))}
			>
				<UndoIcon class="size-4" />
				Restore all {restorable.length}
			</Button>
		{/if}
		<div class="grid gap-2">
			{#each deleted.current as item (item.id)}
				{@const writable = canWrite(collectionRole(item.collectionId))}
				<div class="flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">{item.name || 'Untitled item'}</p>
						<p class="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
							<span class="truncate">{names[item.collectionId] ?? 'a deleted collection'}</span>
							<span>·</span>
							<span>{daysLeft(item.deletedAt!)} days left</span>
							{#if syncConfigured && item.dirty}
								<Badge variant="outline" class="px-1.5 py-0 text-[10px]">Not synced yet</Badge>
							{/if}
						</p>
					</div>
					<Button
						variant="ghost"
						size="sm"
						disabled={busy || !writable}
						title={writable ? 'Restore' : 'You can no longer write to that collection'}
						onclick={() => restore([item.id])}
					>
						<UndoIcon class="size-4" />
						Restore
					</Button>
				</div>
			{/each}
		</div>
		{#if syncConfigured && syncStatus.pendingChanges > 0}
			<p class="mt-4 text-xs text-muted-foreground">
				Some deletions haven't reached the cloud yet. Emptying the trash keeps those until they
				have, so the deletion still reaches your other devices.
			</p>
		{/if}
	{/if}
</div>

<AlertDialog.Root bind:open={confirmingEmpty}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Empty the trash?</AlertDialog.Title>
			<AlertDialog.Description>
				Every item in here is removed for good. This one really can't be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive text-white hover:bg-destructive/90"
				onclick={emptyTrash}
			>
				Empty
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
