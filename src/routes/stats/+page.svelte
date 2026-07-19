<script lang="ts">
	import { base } from '$app/paths';
	import { db } from '$lib/db/schema';
	import type { Item } from '$lib/db/types';
	import { live } from '$lib/state/live.svelte';
	import { collectionsLive, itemCountsLive } from '$lib/state/collections.svelte';
	import { settings } from '$lib/state/settings.svelte';
	import {
		countByStatus,
		recentItems,
		summarizeItems,
		topValuableItems
	} from '$lib/summary';
	import { childrenOf, descendantIds, rollupCounts } from '$lib/tree';
	import { formatMoney } from '$lib/currency';
	import CollectionSummary from '$lib/components/CollectionSummary.svelte';
	import ItemGridSkeleton from '$lib/components/ItemGridSkeleton.svelte';
	import Thumb from '$lib/components/Thumb.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Badge } from '$lib/components/ui/badge';
	import PackageOpenIcon from '@lucide/svelte/icons/package-open';

	const items = $derived(
		live<Item[]>(() => db.items.filter((i) => !i.deletedAt).toArray(), [])
	);
	const thumbs = $derived(
		live<Record<string, Blob | null>>(async () => {
			const map: Record<string, Blob | null> = {};
			await db.photos
				.filter((p) => !p.deletedAt && !!p.thumb)
				.each((p) => {
					if (p.isPrimary || !(p.itemId in map)) map[p.itemId] = p.thumb;
				});
			return map;
		}, {})
	);

	const collections = $derived(collectionsLive.current);
	const loaded = $derived(items.loaded && collectionsLive.loaded);

	const summary = $derived(summarizeItems(items.current, settings.defaultCurrency));
	const statusCounts = $derived(countByStatus(items.current));
	const topItems = $derived(topValuableItems(items.current, 5));
	const recent = $derived(recentItems(items.current, 8));
	const rolled = $derived(rollupCounts(collections, itemCountsLive.current));

	const topLevel = $derived(childrenOf(collections, null));
	// per top-level collection: rolled item count + rolled value across its subtree
	const perCollection = $derived(
		topLevel.map((c) => {
			const ids = descendantIds(collections, c.id);
			const subtreeItems = items.current.filter((i) => ids.has(i.collectionId));
			return {
				collection: c,
				count: rolled[c.id] ?? 0,
				value: summarizeItems(subtreeItems, settings.defaultCurrency).value
			};
		})
	);

	const collectionName = (id: string) => {
		const c = collections.find((c) => c.id === id);
		return c ? `${c.icon ?? '📦'} ${c.name}` : '';
	};
	const money = (list: { currency: string; total: number }[]) =>
		list.length ? list.map((t) => formatMoney(t.total, t.currency)).join(' + ') : '—';
</script>

<svelte:head><title>Stats</title></svelte:head>

<div class="mx-auto max-w-5xl px-4 py-6 md:px-8">
	<h1 class="mb-4 text-2xl font-bold tracking-tight">Stats</h1>

	{#if !loaded}
		<ItemGridSkeleton view="grid" />
	{:else if items.current.length === 0}
		<div class="flex flex-col items-center gap-4 rounded-xl border border-dashed py-16 text-center">
			<PackageOpenIcon class="size-10 text-muted-foreground" />
			<div>
				<p class="font-medium">Nothing to show yet</p>
				<p class="mt-1 text-sm text-muted-foreground">
					Add some items and your collection stats will appear here.
				</p>
			</div>
		</div>
	{:else}
		<div class="grid gap-6">
			<CollectionSummary {summary} />

			<div class="grid grid-cols-3 gap-2">
				<div class="rounded-lg border bg-card px-3 py-2">
					<p class="text-xs text-muted-foreground">Owned</p>
					<p class="mt-0.5 text-sm font-semibold tabular-nums">{statusCounts.owned}</p>
				</div>
				<div class="rounded-lg border bg-card px-3 py-2">
					<p class="text-xs text-muted-foreground">Sold</p>
					<p class="mt-0.5 text-sm font-semibold tabular-nums">{statusCounts.sold}</p>
				</div>
				<div class="rounded-lg border bg-card px-3 py-2">
					<p class="text-xs text-muted-foreground">Wishlist</p>
					<p class="mt-0.5 text-sm font-semibold tabular-nums">{statusCounts.wishlist}</p>
				</div>
			</div>

			{#if perCollection.length}
				<Card.Root>
					<Card.Header>
						<Card.Title>By collection</Card.Title>
					</Card.Header>
					<Card.Content class="grid gap-1">
						{#each perCollection as row (row.collection.id)}
							<a
								href="{base}/collections/{row.collection.id}"
								class="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent"
							>
								<span class="text-xl leading-none">{row.collection.icon ?? '📦'}</span>
								<span class="min-w-0 flex-1 truncate text-sm font-medium">{row.collection.name}</span>
								<span class="text-xs text-muted-foreground tabular-nums">{money(row.value)}</span>
								<Badge variant="secondary" class="tabular-nums">{row.count}</Badge>
							</a>
						{/each}
					</Card.Content>
				</Card.Root>
			{/if}

			{#if topItems.length}
				<Card.Root>
					<Card.Header>
						<Card.Title>Most valuable</Card.Title>
						<Card.Description>By purchase price × quantity. Currencies aren't converted.</Card.Description>
					</Card.Header>
					<Card.Content class="grid gap-1">
						{#each topItems as item (item.id)}
							<a
								href="{base}/items/{item.id}"
								class="flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-accent"
							>
								<Thumb blob={thumbs.current[item.id]} alt={item.name} class="size-10 shrink-0 rounded-md" />
								<div class="min-w-0 flex-1">
									<p class="truncate text-sm font-medium">{item.name || 'Untitled'}</p>
									<p class="truncate text-xs text-muted-foreground">
										{collectionName(item.collectionId)}
									</p>
								</div>
								<span class="text-sm font-semibold tabular-nums">
									{formatMoney(item.acquisitionPrice! * item.quantity, item.currency ?? settings.defaultCurrency)}
								</span>
							</a>
						{/each}
					</Card.Content>
				</Card.Root>
			{/if}

			{#if recent.length}
				<Card.Root>
					<Card.Header>
						<Card.Title>Recently added</Card.Title>
					</Card.Header>
					<Card.Content>
						<div class="grid grid-cols-4 gap-3 sm:grid-cols-8">
							{#each recent as item (item.id)}
								<a href="{base}/items/{item.id}" class="group" title={item.name || 'Untitled'}>
									<Thumb
										blob={thumbs.current[item.id]}
										alt={item.name}
										class="aspect-square w-full rounded-md transition-transform group-hover:scale-105"
									/>
									<p class="mt-1 truncate text-[11px] text-muted-foreground">{item.name || 'Untitled'}</p>
								</a>
							{/each}
						</div>
					</Card.Content>
				</Card.Root>
			{/if}
		</div>
	{/if}
</div>
