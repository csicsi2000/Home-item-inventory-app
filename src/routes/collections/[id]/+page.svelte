<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { db } from '$lib/db/schema';
	import { createItem, deleteItems, updateCollection } from '$lib/db/repo';
	import type { CollectionViewMode, Item, ItemStatus } from '$lib/db/types';
	import { live } from '$lib/state/live.svelte';
	import { collectionsLive, itemCountsLive } from '$lib/state/collections.svelte';
	import ItemCard from '$lib/components/ItemCard.svelte';
	import ItemRow from '$lib/components/ItemRow.svelte';
	import CollectionSummary from '$lib/components/CollectionSummary.svelte';
	import CollectionDialog from '$lib/components/CollectionDialog.svelte';
	import ShareDialog from '$lib/components/ShareDialog.svelte';
	import ItemGridSkeleton from '$lib/components/ItemGridSkeleton.svelte';
	import { canWrite, collectionRole, shareGrantsLive } from '$lib/state/access.svelte';
	import { leaveShare, myUserId } from '$lib/sync/shares';
	import { auth } from '$lib/sync/auth.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { collectionDisplay, itemChips, labelOptions } from '$lib/display';
	import { summarizeItems } from '$lib/summary';
	import { ancestorsOf, childrenOf, descendantIds, rollupCounts } from '$lib/tree';
	import { settings } from '$lib/state/settings.svelte';
	import { cn } from '$lib/utils.js';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import FolderIcon from '@lucide/svelte/icons/folder';
	import FolderPlusIcon from '@lucide/svelte/icons/folder-plus';
	import LayoutGridIcon from '@lucide/svelte/icons/layout-grid';
	import ListIcon from '@lucide/svelte/icons/list';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';
	import CheckSquareIcon from '@lucide/svelte/icons/check-square';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import UsersIcon from '@lucide/svelte/icons/users';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import { toast } from 'svelte-sonner';

	const collectionId = $derived(page.params.id!);

	const collection = $derived(
		live(() => db.collections.get(page.params.id!), undefined, () => page.params.id)
	);

	// folder tree context
	const ancestors = $derived(ancestorsOf(collectionsLive.current, collectionId));
	const children = $derived(childrenOf(collectionsLive.current, collectionId));
	const rolledCounts = $derived(rollupCounts(collectionsLive.current, itemCountsLive.current));

	// items across this collection + every subcollection, for the rolled-up summary
	const rollupIds = $derived([...descendantIds(collectionsLive.current, collectionId)]);
	const rollupItems = $derived(
		live<Item[]>(
			() => db.items.where('collectionId').anyOf(rollupIds).filter((i) => !i.deletedAt).toArray(),
			[],
			() => rollupIds.join(',')
		)
	);
	const summary = $derived(summarizeItems(rollupItems.current, settings.defaultCurrency));

	let subDialogOpen = $state(false);

	// access: my own collections are 'owner'; shared ones carry a granted role
	const role = $derived(collectionRole(collectionId));
	const writable = $derived(canWrite(role));
	const isOwner = $derived(role === 'owner');
	const isForeign = $derived(
		!!collection.current?.ownerId && collection.current.ownerId !== myUserId()
	);
	// "leave" only makes sense where the grant itself lives
	const hasDirectGrant = $derived(
		shareGrantsLive.current.some((g) => g.collectionId === collectionId)
	);
	let shareOpen = $state(false);
	let confirmingLeave = $state(false);

	async function leave() {
		try {
			await leaveShare(collectionId);
			confirmingLeave = false;
			toast.success('Left the shared collection');
			await goto(`${base}/`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not leave the collection');
		}
	}
	const items = $derived(
		live<Item[]>(
			() =>
				db.items
					.where('collectionId')
					.equals(page.params.id!)
					.filter((i) => !i.deletedAt)
					.toArray()
					.then((list) => list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))),
			[],
			() => page.params.id
		)
	);
	const thumbs = $derived(
		live<Record<string, Blob | null>>(
			async () => {
				const map: Record<string, Blob | null> = {};
				await db.photos
					.filter((p) => !p.deletedAt && !!p.thumb)
					.each((p) => {
						if (p.isPrimary || !(p.itemId in map)) map[p.itemId] = p.thumb;
					});
				return map;
			},
			{},
			() => page.params.id
		)
	);

	let query = $state('');
	let statusFilter = $state<ItemStatus | 'all'>('all');

	// per-collection display settings (synced on the collection record)
	const display = $derived(collectionDisplay(collection.current));
	const displayOptions = $derived(labelOptions(collection.current));

	function setView(view: CollectionViewMode) {
		// snapshot: the live record's nested arrays are reactive proxies IndexedDB can't clone
		void updateCollection(collectionId, { display: { ...$state.snapshot(display), view } });
	}
	function toggleLabel(key: string) {
		const labels = display.labels.includes(key)
			? display.labels.filter((l) => l !== key)
			: [...display.labels, key];
		void updateCollection(collectionId, { display: { view: display.view, labels } });
	}

	// bulk selection
	let selecting = $state(false);
	let selected = $state<Set<string>>(new Set());
	let confirmingBulkDelete = $state(false);

	function toggleSelect(id: string) {
		const next = new Set(selected);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		selected = next;
	}
	function exitSelect() {
		selecting = false;
		selected = new Set();
	}
	async function bulkDelete() {
		const ids = [...selected];
		await deleteItems(ids);
		confirmingBulkDelete = false;
		exitSelect();
		toast.success(`Deleted ${ids.length} item${ids.length === 1 ? '' : 's'}`);
	}

	const filtered = $derived(
		items.current.filter((item) => {
			if (statusFilter !== 'all' && item.status !== statusFilter) return false;
			if (!query.trim()) return true;
			const q = query.toLowerCase();
			return (
				item.name.toLowerCase().includes(q) ||
				(item.description ?? '').toLowerCase().includes(q) ||
				(item.barcode ?? '').includes(q) ||
				(item.ocrText ?? '').toLowerCase().includes(q) ||
				item.tags.some((t) => t.toLowerCase().includes(q)) ||
				Object.entries(item.customFields).some(
					([k, v]) => k.toLowerCase().includes(q) || v.toLowerCase().includes(q)
				)
			);
		})
	);

	const allFilteredSelected = $derived(
		filtered.length > 0 && filtered.every((i) => selected.has(i.id))
	);
	function toggleSelectAll() {
		selected = allFilteredSelected ? new Set() : new Set(filtered.map((i) => i.id));
	}

	const statusTabs: { value: ItemStatus | 'all'; label: string }[] = [
		{ value: 'all', label: 'All' },
		{ value: 'owned', label: 'Owned' },
		{ value: 'sold', label: 'Sold' },
		{ value: 'wishlist', label: 'Wishlist' }
	];

	async function addManually() {
		const item = await createItem({ collectionId });
		await goto(`${base}/items/${item.id}?new=1`);
	}
</script>

<svelte:head><title>{collection.current?.name ?? 'Collection'}</title></svelte:head>

<div class="mx-auto max-w-5xl px-4 py-6 md:px-8">
	{#if ancestors.length}
		<nav class="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
			<a href="{base}/" class="hover:text-foreground">Collections</a>
			{#each ancestors as a (a.id)}
				<span>/</span>
				<a href="{base}/collections/{a.id}" class="truncate hover:text-foreground">
					{a.icon ?? '📁'} {a.name}
				</a>
			{/each}
		</nav>
	{/if}
	<div class="mb-4 flex items-center gap-3">
		<Button
			variant="ghost"
			size="icon"
			href={ancestors.length
				? `${base}/collections/${ancestors[ancestors.length - 1].id}`
				: `${base}/`}
			aria-label="Back"
		>
			<ArrowLeftIcon class="size-5" />
		</Button>
		<span class="text-2xl">{collection.current?.icon ?? '📦'}</span>
		<div class="min-w-0 flex-1">
			<h1 class="truncate text-xl font-bold tracking-tight">{collection.current?.name ?? '…'}</h1>
			<p class="flex items-center gap-2 text-xs text-muted-foreground">
				{items.loaded ? `${items.current.length} items` : '…'}{children.length
				? ` · ${children.length} folder${children.length === 1 ? '' : 's'}`
				: ''}
				{#if isForeign}
					<Badge variant="secondary" class="gap-1 px-1.5 py-0 text-[10px]">
						<UsersIcon class="size-3" />
						Shared · {role === 'read' ? 'view only' : role === 'write' ? 'can edit' : 'owner'}
					</Badge>
				{/if}
			</p>
		</div>
		{#if selecting}
			<Button variant="ghost" size="sm" onclick={exitSelect}>Cancel</Button>
		{:else}
			{#if isOwner && auth.session}
				<Button
					variant="ghost"
					size="icon"
					onclick={() => (shareOpen = true)}
					aria-label="Share collection"
					title="Share collection"
				>
					<UsersIcon class="size-5" />
				</Button>
			{/if}
			{#if isForeign && hasDirectGrant}
				<Button
					variant="ghost"
					size="icon"
					onclick={() => (confirmingLeave = true)}
					aria-label="Leave shared collection"
					title="Leave shared collection"
				>
					<LogOutIcon class="size-5" />
				</Button>
			{/if}
			{#if writable}
				{#if items.current.length > 0}
					<Button
						variant="ghost"
						size="icon"
						onclick={() => (selecting = true)}
						aria-label="Select items"
						title="Select items"
					>
						<CheckSquareIcon class="size-5" />
					</Button>
				{/if}
				<Button
					variant="ghost"
					size="icon"
					onclick={() => (subDialogOpen = true)}
					aria-label="New subcollection"
					title="New subcollection"
				>
					<FolderPlusIcon class="size-5" />
				</Button>
				<Button variant="outline" size="sm" onclick={addManually}>
					<PlusIcon class="size-4" />
					<span class="hidden sm:inline">Add</span>
				</Button>
				<Button size="sm" href="{base}/collections/{collectionId}/add">
					<CameraIcon class="size-4" />
					Scan
				</Button>
			{/if}
		{/if}
	</div>

	{#if collection.current?.description}
		<p class="mb-4 text-sm text-muted-foreground">{collection.current.description}</p>
	{/if}

	{#if summary.items > 0}
		<div class="mb-4">
			<CollectionSummary {summary} rolledUp={children.length > 0} />
		</div>
	{/if}

	{#if children.length}
		<div class="mb-5">
			<h2 class="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
				Subcollections
			</h2>
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
				{#each children as child (child.id)}
					<a
						href="{base}/collections/{child.id}"
						class="flex items-center gap-3 rounded-xl border bg-card px-3 py-3 transition-shadow hover:shadow-md"
					>
						<span class="text-2xl leading-none">{child.icon ?? '📁'}</span>
						<div class="min-w-0">
							<p class="truncate text-sm font-medium">{child.name}</p>
							<p class="text-xs text-muted-foreground">{rolledCounts[child.id] ?? 0} items</p>
						</div>
					</a>
				{/each}
			</div>
		</div>
	{/if}

	{#if items.current.length > 0}
		<div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
			<div class="relative flex-1">
				<SearchIcon class="absolute top-2.5 left-3 size-4 text-muted-foreground" />
				<Input bind:value={query} placeholder="Filter items…" class="pl-9" />
			</div>
			<div class="flex items-center gap-1">
				{#each statusTabs as tab (tab.value)}
					<button
						type="button"
						class={cn(
							'rounded-full px-3 py-1 text-xs font-medium transition-colors',
							statusFilter === tab.value
								? 'bg-primary text-primary-foreground'
								: 'bg-muted text-muted-foreground hover:bg-accent'
						)}
						onclick={() => (statusFilter = tab.value)}
					>
						{tab.label}
					</button>
				{/each}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="outline"
								size="icon"
								class="ml-1"
								aria-label="View options"
								title="View options"
							>
								{#if display.view === 'list'}
									<ListIcon class="size-4" />
								{:else}
									<LayoutGridIcon class="size-4" />
								{/if}
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content align="end" class="w-52">
						<DropdownMenu.Label>View</DropdownMenu.Label>
						<DropdownMenu.RadioGroup
							value={display.view}
							onValueChange={(v) => setView(v as CollectionViewMode)}
						>
							<DropdownMenu.RadioItem value="grid" closeOnSelect={false}>
								<LayoutGridIcon class="size-4" />
								Grid
							</DropdownMenu.RadioItem>
							<DropdownMenu.RadioItem value="list" closeOnSelect={false}>
								<ListIcon class="size-4" />
								List
							</DropdownMenu.RadioItem>
						</DropdownMenu.RadioGroup>
						<DropdownMenu.Separator />
						<DropdownMenu.Label>Item labels</DropdownMenu.Label>
						{#each displayOptions as option (option.key)}
							<DropdownMenu.CheckboxItem
								checked={display.labels.includes(option.key)}
								onCheckedChange={() => toggleLabel(option.key)}
								closeOnSelect={false}
							>
								{option.name}
							</DropdownMenu.CheckboxItem>
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			</div>
		</div>
	{/if}

	{#if !items.loaded}
		<ItemGridSkeleton view={display.view} />
	{:else if items.current.length === 0}
		{#if children.length === 0}
			<div
				class="flex flex-col items-center gap-4 rounded-xl border border-dashed py-16 text-center"
			>
				<CameraIcon class="size-10 text-muted-foreground" />
				<div>
					<p class="font-medium">Nothing here yet</p>
					<p class="mt-1 text-sm text-muted-foreground">
						Point your camera at an item to add it in one tap.
					</p>
				</div>
				{#if writable}
					<div class="flex gap-2">
						<Button href="{base}/collections/{collectionId}/add">
							<CameraIcon class="size-4" />
							Scan an item
						</Button>
						<Button variant="outline" onclick={addManually}>Add manually</Button>
					</div>
				{/if}
			</div>
		{/if}
	{:else if filtered.length === 0}
		<p class="py-12 text-center text-sm text-muted-foreground">No items match your filter.</p>
	{:else}
		{#if display.view === 'list'}
			<div class="grid gap-2 pb-20">
				{#each filtered as item (item.id)}
					<ItemRow
						{item}
						thumb={thumbs.current[item.id]}
						chips={itemChips(item, display.labels, collection.current, settings.defaultCurrency)}
						selectable={selecting}
						selected={selected.has(item.id)}
						onToggle={() => toggleSelect(item.id)}
					/>
				{/each}
			</div>
		{:else}
			<div class="grid grid-cols-2 gap-3 pb-20 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
				{#each filtered as item (item.id)}
					<ItemCard
						{item}
						thumb={thumbs.current[item.id]}
						chips={itemChips(item, display.labels, collection.current, settings.defaultCurrency)}
						selectable={selecting}
						selected={selected.has(item.id)}
						onToggle={() => toggleSelect(item.id)}
					/>
				{/each}
			</div>
		{/if}
		{#if statusFilter === 'all' && !query && !selecting}
			<p class="mt-4 text-center text-xs text-muted-foreground">
				<Badge variant="outline" class="mr-1">{filtered.reduce((n, i) => n + i.quantity, 0)}</Badge>
				total pieces including duplicates
			</p>
		{/if}
	{/if}
</div>

<CollectionDialog bind:open={subDialogOpen} parentId={collectionId} />

<ShareDialog
	bind:open={shareOpen}
	{collectionId}
	collectionName={collection.current?.name ?? ''}
/>

<AlertDialog.Root bind:open={confirmingLeave}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Leave “{collection.current?.name}”?</AlertDialog.Title>
			<AlertDialog.Description>
				The collection stays with its owner — it just disappears from your devices until you’re
				invited again.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action onclick={leave}>Leave</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>

{#if selecting}
	<!-- bulk action bar -->
	<div
		class="fixed inset-x-0 bottom-16 z-40 mx-auto flex max-w-2xl items-center gap-2 px-4 md:bottom-4"
		style="padding-bottom: env(safe-area-inset-bottom)"
	>
		<div class="flex w-full items-center gap-2 rounded-xl border bg-background/95 p-2 shadow-lg backdrop-blur">
			<Button variant="ghost" size="sm" onclick={toggleSelectAll}>
				{allFilteredSelected ? 'Clear' : 'Select all'}
			</Button>
			<span class="text-sm text-muted-foreground">{selected.size} selected</span>
			<div class="flex-1"></div>
			<Button
				variant="destructive"
				size="sm"
				disabled={selected.size === 0}
				onclick={() => (confirmingBulkDelete = true)}
			>
				<Trash2Icon class="size-4" />
				Delete
			</Button>
		</div>
	</div>
{/if}

<AlertDialog.Root bind:open={confirmingBulkDelete}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete {selected.size} item{selected.size === 1 ? '' : 's'}?</AlertDialog.Title>
			<AlertDialog.Description>
				They’ll be removed from this collection on every synced device. This can’t be undone.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action class="bg-destructive text-white hover:bg-destructive/90" onclick={bulkDelete}>
				Delete
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
