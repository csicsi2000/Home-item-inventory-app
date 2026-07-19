<script lang="ts">
	import { base } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import { Badge } from '$lib/components/ui/badge';
	import CollectionDialog from '$lib/components/CollectionDialog.svelte';
	import SyncStatusBadge from '$lib/components/SyncStatusBadge.svelte';
	import { collectionsLive, itemCountsLive } from '$lib/state/collections.svelte';
	import { canWrite, collectionRole } from '$lib/state/access.svelte';
	import { createCollection, deleteCollection } from '$lib/db/repo';
	import { childrenOf, rollupCounts } from '$lib/tree';
	import UsersIcon from '@lucide/svelte/icons/users';
	import type { Collection } from '$lib/db/types';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MoreVerticalIcon from '@lucide/svelte/icons/more-vertical';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import PackageOpenIcon from '@lucide/svelte/icons/package-open';

	let dialogOpen = $state(false);
	let editing = $state<Collection | null>(null);
	let deleting = $state<Collection | null>(null);

	const allCollections = $derived(collectionsLive.current);
	// dashboard shows top-level collections only; folders are entered to see their contents
	const collections = $derived(childrenOf(allCollections, null));
	const counts = $derived(rollupCounts(allCollections, itemCountsLive.current));
	const subCounts = $derived(
		Object.fromEntries(allCollections.map((c) => [c.id, childrenOf(allCollections, c.id).length]))
	);

	const starters = [
		{ name: 'Trading cards', icon: '🃏' },
		{ name: 'Electronics', icon: '🔌' },
		{ name: 'Hardware parts', icon: '🔩' }
	];

	function openCreate() {
		editing = null;
		dialogOpen = true;
	}

	function openEdit(c: Collection) {
		editing = c;
		dialogOpen = true;
	}

	async function confirmDelete() {
		if (!deleting) return;
		await deleteCollection(deleting.id);
		deleting = null;
	}
</script>

<svelte:head><title>Collections</title></svelte:head>

<div class="mx-auto max-w-5xl px-4 py-6 md:px-8">
	<div class="mb-6 flex items-center justify-between">
		<h1 class="text-2xl font-bold tracking-tight">Collections</h1>
		<div class="flex items-center gap-1">
			<SyncStatusBadge showLabel={false} />
			<Button onclick={openCreate}>
				<PlusIcon class="size-4" />
				New
			</Button>
		</div>
	</div>

	{#if collections.length === 0}
		<div class="flex flex-col items-center gap-4 rounded-xl border border-dashed py-16 text-center">
			<PackageOpenIcon class="size-10 text-muted-foreground" />
			<div>
				<p class="font-medium">No collections yet</p>
				<p class="mt-1 text-sm text-muted-foreground">
					Create one to start scanning and organizing your stuff.
				</p>
			</div>
			<div class="flex flex-wrap justify-center gap-2 px-4">
				{#each starters as s (s.name)}
					<Button
						variant="outline"
						size="sm"
						onclick={() => createCollection({ name: s.name, icon: s.icon })}
					>
						{s.icon} {s.name}
					</Button>
				{/each}
				<Button size="sm" onclick={openCreate}>
					<PlusIcon class="size-4" />
					Custom…
				</Button>
			</div>
		</div>
	{:else}
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
			{#each collections as collection (collection.id)}
				{@const role = collectionRole(collection.id)}
				<Card.Root class="group relative gap-2 py-4 transition-shadow hover:shadow-md">
					<a
						href="{base}/collections/{collection.id}"
						class="absolute inset-0 z-0 rounded-xl"
						aria-label={collection.name}
					></a>
					<Card.Header class="px-4">
						<div class="flex items-start justify-between">
							<span class="text-3xl leading-none">{collection.icon ?? '📦'}</span>
							{#if canWrite(role)}
								<DropdownMenu.Root>
									<DropdownMenu.Trigger
										class="relative z-10 rounded-md p-1 text-muted-foreground opacity-60 transition-opacity hover:bg-accent group-hover:opacity-100"
									>
										<MoreVerticalIcon class="size-4" />
									</DropdownMenu.Trigger>
									<DropdownMenu.Content align="end">
										<DropdownMenu.Item onclick={() => openEdit(collection)}>
											<PencilIcon class="size-4" /> Edit
										</DropdownMenu.Item>
										{#if role === 'owner'}
											<DropdownMenu.Item
												variant="destructive"
												onclick={() => (deleting = collection)}
											>
												<Trash2Icon class="size-4" /> Delete
											</DropdownMenu.Item>
										{/if}
									</DropdownMenu.Content>
								</DropdownMenu.Root>
							{/if}
						</div>
					</Card.Header>
					<Card.Content class="px-4">
						<p class="truncate font-semibold">{collection.name}</p>
						<div class="mt-1 flex flex-wrap items-center gap-1.5">
							<Badge variant="secondary">{counts[collection.id] ?? 0} items</Badge>
							{#if subCounts[collection.id]}
								<Badge variant="outline" class="gap-1">
									<FolderIcon class="size-3" />
									{subCounts[collection.id]}
								</Badge>
							{/if}
							{#if role !== 'owner'}
								<Badge variant="outline" class="gap-1">
									<UsersIcon class="size-3" />
									Shared
								</Badge>
							{/if}
						</div>
					</Card.Content>
				</Card.Root>
			{/each}
		</div>
	{/if}
</div>

<CollectionDialog bind:open={dialogOpen} collection={editing} />

<AlertDialog.Root open={deleting !== null} onOpenChange={(o) => !o && (deleting = null)}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete “{deleting?.name}”?</AlertDialog.Title>
			<AlertDialog.Description>
				The collection{subCounts[deleting?.id ?? ''] ? ', its subcollections,' : ''} and all
				{counts[deleting?.id ?? ''] ?? 0} items in it will be deleted on every synced device.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive text-white hover:bg-destructive/90"
				onclick={confirmDelete}
			>
				Delete
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
