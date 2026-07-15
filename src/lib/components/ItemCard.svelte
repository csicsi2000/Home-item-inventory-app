<script lang="ts">
	import { base } from '$app/paths';
	import { Badge } from '$lib/components/ui/badge';
	import Thumb from './Thumb.svelte';
	import type { Item } from '$lib/db/types';

	let { item, thumb }: { item: Item; thumb: Blob | null | undefined } = $props();
</script>

<a
	href="{base}/items/{item.id}"
	class="group overflow-hidden rounded-xl border bg-card transition-shadow hover:shadow-md"
>
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
	</div>
	<div class="p-2.5">
		<p class="truncate text-sm font-medium">
			{item.name || 'Untitled item'}
		</p>
		{#if item.tags.length}
			<p class="mt-0.5 truncate text-xs text-muted-foreground">
				{item.tags.map((t) => `#${t}`).join(' ')}
			</p>
		{/if}
	</div>
</a>
