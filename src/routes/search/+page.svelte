<script lang="ts">
	import { db } from '$lib/db/schema';
	import { searchItems, type SearchHit } from '$lib/search';
	import { sortHits, SEARCH_SORT_OPTIONS, type SearchSortKey } from '$lib/search/sort';
	import { collectionsLive } from '$lib/state/collections.svelte';
	import { descendantIds, flattenTree } from '$lib/tree';
	import ItemCard from '$lib/components/ItemCard.svelte';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Select from '$lib/components/ui/select';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SearchXIcon from '@lucide/svelte/icons/search-x';

	let query = $state('');
	let hits = $state<SearchHit[]>([]);
	let thumbs = $state<Record<string, Blob | null>>({});
	let searching = $state(false);
	let searched = $state(false);
	let collectionFilter = $state<string>('all');
	let sortKey = $state<SearchSortKey>('relevance');
	let timer: ReturnType<typeof setTimeout> | undefined;

	const collections = $derived(collectionsLive.current);
	const collectionOptions = $derived(flattenTree(collections));
	const collectionName = (id: string) => {
		const c = collections.find((c) => c.id === id);
		return c ? `${c.icon ?? '📦'} ${c.name}` : '';
	};
	const filterLabel = $derived(
		collectionFilter === 'all' ? 'All collections' : collectionName(collectionFilter)
	);
	const sortLabel = $derived(
		SEARCH_SORT_OPTIONS.find((o) => o.key === sortKey)?.name ?? 'Relevance'
	);

	// results reordered client-side — no re-query needed when only the sort changes
	const sortedHits = $derived(sortHits(hits, sortKey));

	$effect(() => {
		const q = query.trim();
		// track the collection filter so changing it re-runs the search
		const filter = collectionFilter;
		clearTimeout(timer);
		if (!q) {
			hits = [];
			searched = false;
			return;
		}
		timer = setTimeout(async () => {
			searching = true;
			try {
				const collectionIds =
					filter === 'all' ? undefined : descendantIds(collectionsLive.current, filter);
				const results = await searchItems(q, { collectionIds });
				hits = results;
				searched = true;
				const map: Record<string, Blob | null> = {};
				for (const hit of results) {
					const photos = await db.photos
						.where('itemId')
						.equals(hit.item.id)
						.filter((p) => !p.deletedAt && !!p.thumb)
						.toArray();
					map[hit.item.id] = (photos.find((p) => p.isPrimary) ?? photos[0])?.thumb ?? null;
				}
				thumbs = map;
			} finally {
				searching = false;
			}
		}, 150);
	});
</script>

<svelte:head><title>Search</title></svelte:head>

<div class="mx-auto max-w-5xl px-4 py-6 md:px-8">
	<h1 class="mb-4 text-2xl font-bold tracking-tight">Search</h1>

	<div class="relative mb-3">
		<SearchIcon class="absolute top-3 left-3 size-4 text-muted-foreground" />
		<!-- svelte-ignore a11y_autofocus -->
		<Input
			bind:value={query}
			placeholder="Name, tag, barcode, printed text, custom field…"
			class="h-11 pl-9 text-base"
			autofocus
		/>
	</div>

	{#if query.trim()}
		<div class="mb-6 flex flex-wrap items-center gap-2">
			<Select.Root type="single" bind:value={collectionFilter}>
				<Select.Trigger class="h-8 w-auto min-w-40 text-xs">{filterLabel}</Select.Trigger>
				<Select.Content>
					<Select.Item value="all" label="All collections" />
					{#each collectionOptions as row (row.collection.id)}
						<Select.Item
							value={row.collection.id}
							label={`${'  '.repeat(row.depth)}${row.collection.icon ?? '📦'} ${row.collection.name}`}
						/>
					{/each}
				</Select.Content>
			</Select.Root>
			<Select.Root
				type="single"
				value={sortKey}
				onValueChange={(v) => (sortKey = v as SearchSortKey)}
			>
				<Select.Trigger class="h-8 w-auto min-w-32 text-xs">Sort: {sortLabel}</Select.Trigger>
				<Select.Content>
					{#each SEARCH_SORT_OPTIONS as opt (opt.key)}
						<Select.Item value={opt.key} label={opt.name} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	{/if}

	{#if !query.trim()}
		<p class="py-12 text-center text-sm text-muted-foreground">
			Search across every collection — including text read from photos.
		</p>
	{:else if searched && hits.length === 0 && !searching}
		<div class="flex flex-col items-center gap-3 py-12 text-center">
			<SearchXIcon class="size-8 text-muted-foreground" />
			<p class="text-sm text-muted-foreground">
				Nothing found for “{query}”{collectionFilter !== 'all' ? ` in ${filterLabel}` : ''}.
			</p>
			{#if collectionFilter !== 'all'}
				<Button variant="outline" size="sm" onclick={() => (collectionFilter = 'all')}>
					Search everywhere
				</Button>
			{/if}
		</div>
	{:else}
		<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
			{#each sortedHits as hit (hit.item.id)}
				<div class="relative">
					<ItemCard item={hit.item} thumb={thumbs[hit.item.id]} />
					<Badge
						variant="outline"
						class="absolute -top-2 left-2 max-w-[85%] truncate bg-background text-[10px]"
					>
						{collectionName(hit.item.collectionId)}
					</Badge>
				</div>
			{/each}
		</div>
	{/if}
</div>
