<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { db } from '$lib/db/schema';
	import { createItem } from '$lib/db/repo';
	import type { Item, ItemStatus } from '$lib/db/types';
	import { live } from '$lib/state/live.svelte';
	import ItemCard from '$lib/components/ItemCard.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import { cn } from '$lib/utils.js';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SearchIcon from '@lucide/svelte/icons/search';

	const collectionId = $derived(page.params.id!);

	const collection = $derived(
		live(() => db.collections.get(page.params.id!), undefined, () => page.params.id)
	);
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
	<div class="mb-4 flex items-center gap-3">
		<Button variant="ghost" size="icon" href="{base}/" aria-label="Back to collections">
			<ArrowLeftIcon class="size-5" />
		</Button>
		<span class="text-2xl">{collection.current?.icon ?? '📦'}</span>
		<div class="min-w-0 flex-1">
			<h1 class="truncate text-xl font-bold tracking-tight">{collection.current?.name ?? '…'}</h1>
			<p class="text-xs text-muted-foreground">{items.current.length} items</p>
		</div>
		<Button variant="outline" size="sm" onclick={addManually}>
			<PlusIcon class="size-4" />
			<span class="hidden sm:inline">Add</span>
		</Button>
		<Button size="sm" href="{base}/collections/{collectionId}/add">
			<CameraIcon class="size-4" />
			Scan
		</Button>
	</div>

	{#if collection.current?.description}
		<p class="mb-4 text-sm text-muted-foreground">{collection.current.description}</p>
	{/if}

	{#if items.current.length > 0}
		<div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
			<div class="relative flex-1">
				<SearchIcon class="absolute top-2.5 left-3 size-4 text-muted-foreground" />
				<Input bind:value={query} placeholder="Filter items…" class="pl-9" />
			</div>
			<div class="flex gap-1">
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
			</div>
		</div>
	{/if}

	{#if items.current.length === 0}
		<div class="flex flex-col items-center gap-4 rounded-xl border border-dashed py-16 text-center">
			<CameraIcon class="size-10 text-muted-foreground" />
			<div>
				<p class="font-medium">Nothing here yet</p>
				<p class="mt-1 text-sm text-muted-foreground">
					Point your camera at an item to add it in one tap.
				</p>
			</div>
			<div class="flex gap-2">
				<Button href="{base}/collections/{collectionId}/add">
					<CameraIcon class="size-4" />
					Scan an item
				</Button>
				<Button variant="outline" onclick={addManually}>Add manually</Button>
			</div>
		</div>
	{:else if filtered.length === 0}
		<p class="py-12 text-center text-sm text-muted-foreground">No items match your filter.</p>
	{:else}
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
			{#each filtered as item (item.id)}
				<ItemCard {item} thumb={thumbs.current[item.id]} />
			{/each}
		</div>
		{#if statusFilter === 'all' && !query}
			<p class="mt-4 text-center text-xs text-muted-foreground">
				<Badge variant="outline" class="mr-1">{filtered.reduce((n, i) => n + i.quantity, 0)}</Badge>
				total pieces including duplicates
			</p>
		{/if}
	{/if}
</div>
