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
</script>

{#snippet body()}
	<div class="relative size-12 shrink-0 overflow-hidden rounded-lg border">
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
		<p class="truncate text-sm font-medium">
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
		class="flex items-center gap-3 rounded-xl border bg-card px-3 py-2 transition-shadow hover:shadow-md"
	>
		{@render body()}
	</a>
{/if}
