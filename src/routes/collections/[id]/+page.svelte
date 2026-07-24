<script lang="ts">
	import { flushSync } from 'svelte';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { morph } from '$lib/state/morph.svelte';
	import { db } from '$lib/db/schema';
	import {
		addTagToItems,
		createItem,
		deleteItems,
		moveItems,
		setItemsStatus,
		updateCollection
	} from '$lib/db/repo';
	import type { Collection, CollectionSort, CollectionViewMode, Item, ItemStatus, SortKey } from '$lib/db/types';
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
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Popover from '$lib/components/ui/popover';
	import { collectionDisplay, DEFAULT_SORT, itemChips, labelOptions, sortItems, SORT_OPTIONS } from '$lib/display';
	import { itemsToCsv } from '$lib/csv';
	import { summarizeItems } from '$lib/summary';
	import { ancestorsOf, childrenOf, descendantIds, flattenTree, rollupCounts } from '$lib/tree';
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
	import EllipsisVerticalIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import SlidersHorizontalIcon from '@lucide/svelte/icons/sliders-horizontal';
	import ArrowUpIcon from '@lucide/svelte/icons/arrow-up';
	import ArrowDownIcon from '@lucide/svelte/icons/arrow-down';
	import FolderInputIcon from '@lucide/svelte/icons/folder-input';
	import TagIcon from '@lucide/svelte/icons/tag';
	import TagsIcon from '@lucide/svelte/icons/tags';
	import FileSpreadsheetIcon from '@lucide/svelte/icons/file-spreadsheet';
	import { toast } from 'svelte-sonner';

	const collectionId = $derived(page.params.id!);

	// Tag the tapped collection as the shared element so it grows into its page,
	// stashing its name + emoji so the detail page can render them as the morph
	// target before its own data loads.
	function startMorph(c: Collection) {
		morph.set(c.id, c.name, c.icon ?? '📁');
		flushSync();
	}

	// Reverse morph into the all-collections dashboard tile — it renders instantly
	// from the warm store, so the morph target is ready. `toDashboard` is true for
	// the back button only when there's no parent, and always for the "Collections"
	// crumb. Stepping up to a parent hits an async grid, so slide back instead.
	function backMorph(toDashboard: boolean) {
		if (toDashboard) {
			morph.id = collectionId;
			flushSync();
		} else {
			morph.back = true;
		}
	}

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
	const canShare = $derived(isOwner && !!auth.session);
	const canLeave = $derived(isForeign && hasDirectGrant);
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
					.toArray(),
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

	// The summary (rolled-up query), the toolbar and the item grid come from
	// separate live queries that resolve at slightly different times. Hold them
	// all behind one flag so they reveal together instead of shoving each other
	// down the page in two or three separate reflows.
	const contentLoaded = $derived(items.loaded && rollupItems.loaded);

	let query = $state('');
	let statusFilter = $state<ItemStatus | 'all'>('all');
	// session-only facet filters (not persisted)
	let tagFilter = $state<Set<string>>(new Set());
	let conditionFilter = $state<string | null>(null);
	let priceMin = $state<number | null>(null);
	let priceMax = $state<number | null>(null);

	// per-collection display settings (synced on the collection record)
	const display = $derived(collectionDisplay(collection.current));
	const displayOptions = $derived(labelOptions(collection.current));

	// Read-only shares can't persist a sort (the push would fail RLS), so keep a
	// session-local override; own collections also persist it on the record.
	let sortOverride = $state<CollectionSort | null>(null);
	const effectiveSort = $derived(sortOverride ?? display.sort ?? DEFAULT_SORT);

	function setSort(sort: CollectionSort) {
		sortOverride = sort;
		if (writable) {
			// snapshot: the live record's nested arrays are reactive proxies IndexedDB can't clone
			void updateCollection(collectionId, { display: { ...$state.snapshot(display), sort } });
		}
	}
	function setSortKey(key: SortKey) {
		setSort({ key, dir: effectiveSort.dir });
	}
	function toggleSortDir() {
		setSort({ key: effectiveSort.key, dir: effectiveSort.dir === 'asc' ? 'desc' : 'asc' });
	}

	function setView(view: CollectionViewMode) {
		// snapshot: the live record's nested arrays are reactive proxies IndexedDB can't clone
		void updateCollection(collectionId, { display: { ...$state.snapshot(display), view } });
	}
	function toggleLabel(key: string) {
		const labels = display.labels.includes(key)
			? display.labels.filter((l) => l !== key)
			: [...display.labels, key];
		void updateCollection(collectionId, { display: { ...$state.snapshot(display), labels } });
	}

	// distinct facet values from the loaded items, for the filter controls
	const tagOptions = $derived(
		[...new Set(items.current.flatMap((i) => i.tags))].sort((a, b) => a.localeCompare(b))
	);
	const conditionOptions = $derived(
		[...new Set(items.current.map((i) => i.condition).filter((c): c is string => !!c))].sort((a, b) =>
			a.localeCompare(b)
		)
	);
	const activeFilterCount = $derived(
		tagFilter.size +
			(conditionFilter ? 1 : 0) +
			(priceMin !== null ? 1 : 0) +
			(priceMax !== null ? 1 : 0)
	);
	function toggleTagFilter(tag: string) {
		const next = new Set(tagFilter);
		if (next.has(tag)) next.delete(tag);
		else next.add(tag);
		tagFilter = next;
	}
	function clearFilters() {
		tagFilter = new Set();
		conditionFilter = null;
		priceMin = null;
		priceMax = null;
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

	const plural = (n: number) => `${n} item${n === 1 ? '' : 's'}`;

	// bulk: move to another collection
	let moveDialogOpen = $state(false);
	// writable collections other than this one, in tree order with depth for indenting
	const moveTargets = $derived(
		flattenTree(collectionsLive.current).filter(
			(row) => row.collection.id !== collectionId && canWrite(collectionRole(row.collection.id))
		)
	);
	async function moveSelectedTo(targetId: string, targetName: string) {
		const ids = [...selected];
		await moveItems(ids, targetId);
		moveDialogOpen = false;
		exitSelect();
		toast.success(`Moved ${plural(ids.length)} to ${targetName}`);
	}

	async function setSelectedStatus(status: ItemStatus) {
		const ids = [...selected];
		await setItemsStatus(ids, status);
		exitSelect();
		toast.success(`Marked ${plural(ids.length)} as ${status}`);
	}

	// bulk: add a tag
	let tagDialogOpen = $state(false);
	let newTag = $state('');
	async function addSelectedTag() {
		const tag = newTag.trim();
		if (!tag) return;
		const ids = [...selected];
		await addTagToItems(ids, tag);
		tagDialogOpen = false;
		newTag = '';
		exitSelect();
		toast.success(`Tagged ${plural(ids.length)} with #${tag}`);
	}

	const filtered = $derived(
		items.current.filter((item) => {
			if (statusFilter !== 'all' && item.status !== statusFilter) return false;
			if (tagFilter.size && !item.tags.some((t) => tagFilter.has(t))) return false;
			if (conditionFilter && item.condition !== conditionFilter) return false;
			if (priceMin !== null && (item.acquisitionPrice ?? -Infinity) < priceMin) return false;
			if (priceMax !== null && (item.acquisitionPrice ?? Infinity) > priceMax) return false;
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
	const sorted = $derived(sortItems(filtered, effectiveSort));

	const allFilteredSelected = $derived(
		sorted.length > 0 && sorted.every((i) => selected.has(i.id))
	);
	function toggleSelectAll() {
		selected = allFilteredSelected ? new Set() : new Set(sorted.map((i) => i.id));
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

	// export this collection + its subcollections to CSV (read-only, any role)
	async function exportCsv() {
		const ids = [...descendantIds(collectionsLive.current, collectionId)];
		const [collections, exportItems] = await Promise.all([
			db.collections.filter((c) => !c.deletedAt).toArray(),
			db.items.where('collectionId').anyOf(ids).filter((i) => !i.deletedAt).toArray()
		]);
		if (exportItems.length === 0) {
			toast.info('No items to export');
			return;
		}
		const slug =
			(collection.current?.name ?? 'collection')
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-+|-+$/g, '') || 'collection';
		const blob = new Blob([itemsToCsv(exportItems, collections)], {
			type: 'text/csv;charset=utf-8'
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `${slug}-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(url);
	}
</script>

<svelte:head><title>{collection.current?.name ?? 'Collection'}</title></svelte:head>

<div
	class="mx-auto max-w-5xl px-4 py-6 md:px-8"
	style:view-transition-name={morph.id === collectionId ? 'card-hero' : undefined}
>
	{#if ancestors.length}
		<nav class="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
			<a href="{base}/" onclick={() => backMorph(true)} class="hover:text-foreground">Collections</a>
			{#each ancestors as a (a.id)}
				<span>/</span>
				<a
					href="{base}/collections/{a.id}"
					onclick={() => backMorph(false)}
					class="truncate hover:text-foreground"
				>
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
			onclick={() => backMorph(ancestors.length === 0)}
			aria-label="Back"
		>
			<ArrowLeftIcon class="size-5" />
		</Button>
		<span
			class="text-2xl"
			style:view-transition-name={morph.id === collectionId ? 'card-icon' : undefined}
		>{collection.current?.icon ?? (morph.id === collectionId ? morph.icon : null) ?? '📦'}</span>
		<div class="min-w-0 flex-1">
			<h1
				class="truncate text-xl font-bold tracking-tight"
				style:view-transition-name={morph.id === collectionId ? 'card-title' : undefined}
			>
				{collection.current?.name ?? (morph.id === collectionId ? morph.label : null) ?? '…'}
			</h1>
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
			<div class="flex items-center gap-1">
				<!-- primary action, always visible -->
				{#if writable}
					<Button size="sm" href="{base}/collections/{collectionId}/add">
						<CameraIcon class="size-4" />
						Scan
					</Button>
				{/if}

				<!-- secondary actions: inline icon buttons on ≥sm -->
				<div class="hidden items-center gap-1 sm:flex">
					<Button
						variant="ghost"
						size="icon"
						onclick={exportCsv}
						aria-label="Export as CSV"
						title="Export as CSV"
					>
						<FileSpreadsheetIcon class="size-5" />
					</Button>
					{#if canShare}
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
					{#if canLeave}
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
						<Button
							variant="ghost"
							size="icon"
							onclick={addManually}
							aria-label="Add manually"
							title="Add manually"
						>
							<PlusIcon class="size-5" />
						</Button>
					{/if}
				</div>

				<!-- secondary actions: overflow menu on mobile -->
				<DropdownMenu.Root>
						<DropdownMenu.Trigger>
							{#snippet child({ props })}
								<Button
									{...props}
									variant="ghost"
									size="icon"
									class="sm:hidden"
									aria-label="More actions"
									title="More actions"
								>
									<EllipsisVerticalIcon class="size-5" />
								</Button>
							{/snippet}
						</DropdownMenu.Trigger>
						<DropdownMenu.Content align="end" class="w-52">
							<DropdownMenu.Item onSelect={exportCsv}>
								<FileSpreadsheetIcon class="size-4" />
								Export as CSV
							</DropdownMenu.Item>
							{#if writable}
								<DropdownMenu.Item onSelect={addManually}>
									<PlusIcon class="size-4" />
									Add manually
								</DropdownMenu.Item>
								<DropdownMenu.Item onSelect={() => (subDialogOpen = true)}>
									<FolderPlusIcon class="size-4" />
									New subcollection
								</DropdownMenu.Item>
								{#if items.current.length > 0}
									<DropdownMenu.Item onSelect={() => (selecting = true)}>
										<CheckSquareIcon class="size-4" />
										Select items
									</DropdownMenu.Item>
								{/if}
							{/if}
							{#if canShare}
								<DropdownMenu.Item onSelect={() => (shareOpen = true)}>
									<UsersIcon class="size-4" />
									Share
								</DropdownMenu.Item>
							{/if}
							{#if canLeave}
								<DropdownMenu.Item variant="destructive" onSelect={() => (confirmingLeave = true)}>
									<LogOutIcon class="size-4" />
									Leave collection
								</DropdownMenu.Item>
							{/if}
						</DropdownMenu.Content>
					</DropdownMenu.Root>
			</div>
		{/if}
	</div>

	{#if collection.current?.description}
		<p class="mb-4 text-sm text-muted-foreground">{collection.current.description}</p>
	{/if}

	{#if contentLoaded && summary.items > 0}
		<div class="mb-4">
			<CollectionSummary {summary} rolledUp={children.length > 0} />
		</div>
	{/if}

	{#if contentLoaded && children.length}
		<div class="mb-5">
			<h2 class="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
				Subcollections
			</h2>
			<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
				{#each children as child (child.id)}
					<a
						href="{base}/collections/{child.id}"
						onclick={() => startMorph(child)}
						style:view-transition-name={morph.id === child.id ? 'card-hero' : undefined}
						class="flex items-center gap-3 rounded-xl border bg-card px-3 py-3 transition-shadow hover:shadow-md"
					>
						<span
							class="text-2xl leading-none"
							style:view-transition-name={morph.id === child.id ? 'card-icon' : undefined}
						>{child.icon ?? '📁'}</span>
						<div class="min-w-0">
							<p
								class="truncate text-sm font-medium"
								style:view-transition-name={morph.id === child.id ? 'card-title' : undefined}
							>
								{child.name}
							</p>
							<p class="text-xs text-muted-foreground">{rolledCounts[child.id] ?? 0} items</p>
						</div>
					</a>
				{/each}
			</div>
		</div>
	{/if}

	{#if contentLoaded && items.current.length > 0}
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
				<Popover.Root>
					<Popover.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant={activeFilterCount ? 'default' : 'outline'}
								size="icon"
								class="relative ml-1"
								aria-label="Filters"
								title="Filters"
							>
								<SlidersHorizontalIcon class="size-4" />
								{#if activeFilterCount}
									<span
										class="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground"
									>
										{activeFilterCount}
									</span>
								{/if}
							</Button>
						{/snippet}
					</Popover.Trigger>
					<Popover.Content align="end" class="w-72 space-y-4">
						<div class="flex items-center justify-between">
							<p class="text-sm font-medium">Filters</p>
							{#if activeFilterCount}
								<Button variant="ghost" size="sm" class="h-7 px-2 text-xs" onclick={clearFilters}>
									Clear all
								</Button>
							{/if}
						</div>
						{#if tagOptions.length}
							<div class="space-y-2">
								<p class="text-xs font-medium text-muted-foreground">Tags</p>
								<div class="flex flex-wrap gap-1.5">
									{#each tagOptions as tag (tag)}
										<button
											type="button"
											class={cn(
												'rounded-full px-2.5 py-1 text-xs transition-colors',
												tagFilter.has(tag)
													? 'bg-primary text-primary-foreground'
													: 'bg-muted text-muted-foreground hover:bg-accent'
											)}
											onclick={() => toggleTagFilter(tag)}
										>
											#{tag}
										</button>
									{/each}
								</div>
							</div>
						{/if}
						{#if conditionOptions.length}
							<div class="space-y-2">
								<p class="text-xs font-medium text-muted-foreground">Condition</p>
								<div class="flex flex-wrap gap-1.5">
									{#each conditionOptions as cond (cond)}
										<button
											type="button"
											class={cn(
												'rounded-full px-2.5 py-1 text-xs transition-colors',
												conditionFilter === cond
													? 'bg-primary text-primary-foreground'
													: 'bg-muted text-muted-foreground hover:bg-accent'
											)}
											onclick={() => (conditionFilter = conditionFilter === cond ? null : cond)}
										>
											{cond}
										</button>
									{/each}
								</div>
							</div>
						{/if}
						<div class="space-y-2">
							<p class="text-xs font-medium text-muted-foreground">Price</p>
							<div class="flex items-center gap-2">
								<Input
									type="number"
									inputmode="decimal"
									placeholder="Min"
									class="h-8"
									value={priceMin ?? ''}
									oninput={(e) => {
										const v = e.currentTarget.value;
										priceMin = v === '' ? null : Number(v);
									}}
								/>
								<span class="text-muted-foreground">–</span>
								<Input
									type="number"
									inputmode="decimal"
									placeholder="Max"
									class="h-8"
									value={priceMax ?? ''}
									oninput={(e) => {
										const v = e.currentTarget.value;
										priceMax = v === '' ? null : Number(v);
									}}
								/>
							</div>
						</div>
						{#if !tagOptions.length && !conditionOptions.length}
							<p class="text-xs text-muted-foreground">Add tags or conditions to items to filter by them.</p>
						{/if}
					</Popover.Content>
				</Popover.Root>
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
						<div class="flex items-center justify-between px-2 py-1.5">
							<span class="text-xs font-semibold text-muted-foreground">Sort</span>
							<Button
								variant="ghost"
								size="sm"
								class="h-6 gap-1 px-1.5 text-xs"
								onclick={toggleSortDir}
							>
								{#if effectiveSort.dir === 'asc'}
									<ArrowUpIcon class="size-3.5" /> Asc
								{:else}
									<ArrowDownIcon class="size-3.5" /> Desc
								{/if}
							</Button>
						</div>
						<DropdownMenu.RadioGroup
							value={effectiveSort.key}
							onValueChange={(v) => setSortKey(v as SortKey)}
						>
							{#each SORT_OPTIONS as opt (opt.key)}
								<DropdownMenu.RadioItem value={opt.key} closeOnSelect={false}>
									{opt.name}
								</DropdownMenu.RadioItem>
							{/each}
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

	{#if !contentLoaded}
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
	{:else if sorted.length === 0}
		<div class="flex flex-col items-center gap-3 py-12 text-center">
			<p class="text-sm text-muted-foreground">No items match your filter.</p>
			{#if activeFilterCount || query || statusFilter !== 'all'}
				<Button
					variant="outline"
					size="sm"
					onclick={() => {
						clearFilters();
						query = '';
						statusFilter = 'all';
					}}
				>
					Clear filters
				</Button>
			{/if}
		</div>
	{:else}
		{#if display.view === 'list'}
			<div class="grid gap-2 pb-20">
				{#each sorted as item (item.id)}
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
				{#each sorted as item (item.id)}
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
		{#if statusFilter === 'all' && !query && !activeFilterCount && !selecting}
			<p class="mt-4 text-center text-xs text-muted-foreground">
				<Badge variant="outline" class="mr-1">{sorted.reduce((n, i) => n + i.quantity, 0)}</Badge>
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
		<div class="flex w-full items-center gap-1.5 rounded-xl border bg-background/95 p-2 shadow-lg backdrop-blur">
			<Button variant="ghost" size="sm" class="shrink-0 px-2" onclick={toggleSelectAll}>
				{allFilteredSelected ? 'Clear' : 'Select all'}
			</Button>
			<span class="shrink-0 text-sm whitespace-nowrap text-muted-foreground">
				{selected.size} selected
			</span>
			<div class="flex-1"></div>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							size="sm"
							class="shrink-0"
							disabled={selected.size === 0}
						>
							<EllipsisVerticalIcon class="size-4" />
							Actions
						</Button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content align="end" class="w-48">
					<DropdownMenu.Item onSelect={() => (moveDialogOpen = true)}>
						<FolderInputIcon class="size-4" />
						Move to…
					</DropdownMenu.Item>
					<DropdownMenu.Sub>
						<DropdownMenu.SubTrigger>
							<TagsIcon class="size-4" />
							Set status
						</DropdownMenu.SubTrigger>
						<DropdownMenu.SubContent>
							<DropdownMenu.Item onSelect={() => setSelectedStatus('owned')}>Owned</DropdownMenu.Item>
							<DropdownMenu.Item onSelect={() => setSelectedStatus('sold')}>Sold</DropdownMenu.Item>
							<DropdownMenu.Item onSelect={() => setSelectedStatus('wishlist')}>
								Wishlist
							</DropdownMenu.Item>
						</DropdownMenu.SubContent>
					</DropdownMenu.Sub>
					<DropdownMenu.Item onSelect={() => (tagDialogOpen = true)}>
						<TagIcon class="size-4" />
						Add tag…
					</DropdownMenu.Item>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
			<Button
				variant="destructive"
				size="sm"
				class="shrink-0"
				disabled={selected.size === 0}
				onclick={() => (confirmingBulkDelete = true)}
			>
				<Trash2Icon class="size-4" />
				<span class="hidden sm:inline">Delete</span>
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

<Dialog.Root bind:open={moveDialogOpen}>
	<Dialog.Content class="max-h-[80vh] overflow-hidden">
		<Dialog.Header>
			<Dialog.Title>Move {selected.size} item{selected.size === 1 ? '' : 's'}</Dialog.Title>
			<Dialog.Description>Pick a destination collection.</Dialog.Description>
		</Dialog.Header>
		<div class="-mx-1 max-h-[50vh] overflow-y-auto px-1">
			{#if moveTargets.length === 0}
				<p class="py-6 text-center text-sm text-muted-foreground">
					No other collection you can edit.
				</p>
			{:else}
				<div class="grid gap-0.5">
					{#each moveTargets as row (row.collection.id)}
						<button
							type="button"
							class="flex items-center gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-accent"
							style="padding-left: {row.depth * 1 + 0.5}rem"
							onclick={() => moveSelectedTo(row.collection.id, row.collection.name)}
						>
							<span class="text-base leading-none">{row.collection.icon ?? '📦'}</span>
							<span class="truncate">{row.collection.name}</span>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={tagDialogOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Tag {selected.size} item{selected.size === 1 ? '' : 's'}</Dialog.Title>
			<Dialog.Description>Add a tag to the selected items.</Dialog.Description>
		</Dialog.Header>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				void addSelectedTag();
			}}
			class="flex gap-2"
		>
			<Input bind:value={newTag} placeholder="e.g. rare" />
			<Button type="submit" disabled={!newTag.trim()}>Add</Button>
		</form>
	</Dialog.Content>
</Dialog.Root>
