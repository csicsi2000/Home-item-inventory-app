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
		chips = [],
		selectable = false,
		selected = false,
		onToggle
	}: {
		item: Item;
		thumb: Blob | null | undefined;
		/** Short label texts shown next to the name (already formatted). */
		chips?: string[];
		selectable?: boolean;
		selected?: boolean;
		onToggle?: () => void;
	} = $props();

	// Tag this row as the shared element so it morphs into the detail page, and
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
		class="relative size-12 shrink-0 overflow-hidden rounded-lg border"
		style:view-transition-name={morph.id === item.id && thumb ? 'card-thumb' : undefined}
	>
		<Thumb blob={thumb} alt={item.name} class="size-full" />
		{#if selectable}
			<div
				class={cn(
					'absolute inset-0 flex items-center justify-center',
					selected ? 'bg-primary/70 text-primary-foreground' : 'bg-black/20'
				)}
			>
				{#if selected}<CheckIcon class="size-5" />{/if}
			</div>
		{/if}
	</div>
	<div class="min-w-0 flex-1">
		<p
			class="truncate text-sm font-medium"
			style:view-transition-name={morph.id === item.id ? 'card-title' : undefined}
		>
			{item.name || 'Untitled item'}
			{#if item.quantity > 1}
				<span class="font-normal text-muted-foreground">×{item.quantity}</span>
			{/if}
		</p>
		{#if chips.length}
			<p class="truncate text-xs text-muted-foreground">{chips.join(' · ')}</p>
		{/if}
	</div>
	{#if item.status !== 'owned'}
		<Badge
			variant={item.status === 'sold' ? 'destructive' : 'secondary'}
			class="shrink-0 capitalize"
		>
			{item.status}
		</Badge>
	{/if}
{/snippet}

{#if selectable}
	<button
		type="button"
		onclick={onToggle}
		class={cn(
			'flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-2 text-left transition-shadow hover:shadow-md',
			selected && 'ring-2 ring-primary'
		)}
	>
		{@render body()}
	</button>
{:else}
	<a
		href="{base}/items/{item.id}"
		onclick={startMorph}
		class="flex items-center gap-3 rounded-xl border bg-card px-3 py-2 transition-shadow hover:shadow-md"
	>
		{@render body()}
	</a>
{/if}
