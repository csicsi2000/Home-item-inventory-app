<script lang="ts">
	import { flushSync } from 'svelte';
	import { base } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge';
	import Thumb from './Thumb.svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import type { Item } from '$lib/db/types';
	import { cn } from '$lib/utils.js';
	import { morph } from '$lib/state/morph.svelte';

	let {
		item,
		thumb,
		chips,
		selectable = false,
		selected = false,
		onToggle
	}: {
		item: Item;
		thumb: Blob | null | undefined;
		/** Short label texts under the name; omit to fall back to the item's tags. */
		chips?: string[];
		selectable?: boolean;
		selected?: boolean;
		onToggle?: () => void;
	} = $props();

	const meta = $derived(chips ?? (item.tags.length ? [item.tags.map((t) => `#${t}`).join(' ')] : []));

	// Tag this card as the shared element so it morphs into the detail page, and
	// stash its name + photo so the detail page can render them as the morph
	// target before its own data loads. flushSync applies the name to the DOM
	// before the View Transition snapshots.
	function startMorph() {
		morph.set(item.id, item.name || 'Untitled item', null, thumb ?? null);
		flushSync();
	}
</script>

{#snippet body()}
	<div
		class="relative aspect-square w-full overflow-hidden"
		style:view-transition-name={morph.id === item.id && thumb ? 'card-thumb' : undefined}
	>
		<Thumb blob={thumb} alt={item.name} class="size-full transition-transform group-hover:scale-[1.03]" />
		{#if item.quantity > 1}
			<Badge class="absolute top-2 right-2 bg-background/85 text-foreground backdrop-blur">
				×{item.quantity}
			</Badge>
		{/if}
		{#if item.status !== 'owned'}
			<Badge
				variant={item.status === 'sold' ? 'destructive' : 'secondary'}
				class="absolute top-2 left-2 capitalize"
			>
				{item.status}
			</Badge>
		{/if}
		{#if selectable}
			<div
				class={cn(
					'absolute top-2 left-2 flex size-6 items-center justify-center rounded-full border-2 shadow',
					selected ? 'border-primary bg-primary text-primary-foreground' : 'border-white bg-black/30'
				)}
			>
				{#if selected}<CheckIcon class="size-4" />{/if}
			</div>
		{/if}
	</div>
	<div class="p-2.5">
		<p
			class="truncate text-sm font-medium"
			style:view-transition-name={morph.id === item.id ? 'card-title' : undefined}
		>
			{item.name || 'Untitled item'}
		</p>
		{#each meta as chip, i (i)}
			<p class="mt-0.5 truncate text-xs text-muted-foreground">{chip}</p>
		{/each}
	</div>
{/snippet}

{#if selectable}
	<button
		type="button"
		onclick={onToggle}
		class={cn(
			'group block overflow-hidden rounded-xl border bg-card text-left transition-shadow hover:shadow-md',
			selected && 'ring-2 ring-primary'
		)}
	>
		{@render body()}
	</button>
{:else}
	<a
		href="{base}/items/{item.id}"
		onclick={startMorph}
		class="group block overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md"
	>
		{@render body()}
	</a>
{/if}
