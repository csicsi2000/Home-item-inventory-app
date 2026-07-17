<script lang="ts">
	import { base } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge';
	import Thumb from './Thumb.svelte';
	import CheckIcon from '@lucide/svelte/icons/check';
	import type { Item } from '$lib/db/types';
	import { cn } from '$lib/utils.js';

	let {
		item,
		thumb,
		selectable = false,
		selected = false,
		onToggle
	}: {
		item: Item;
		thumb: Blob | null | undefined;
		selectable?: boolean;
		selected?: boolean;
		onToggle?: () => void;
	} = $props();
</script>

{#snippet body()}
	<div class="relative aspect-square w-full overflow-hidden">
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
		<p class="truncate text-sm font-medium">{item.name || 'Untitled item'}</p>
		{#if item.tags.length}
			<p class="mt-0.5 truncate text-xs text-muted-foreground">
				{item.tags.map((t) => `#${t}`).join(' ')}
			</p>
		{/if}
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
		class="group block overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md"
	>
		{@render body()}
	</a>
{/if}
