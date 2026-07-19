<script lang="ts">
	import { Skeleton } from '$lib/components/ui/skeleton';

	// mirrors the item card / row layouts so nothing jumps when items land
	let { count = 10, view = 'grid' }: { count?: number; view?: 'grid' | 'list' } = $props();
</script>

{#if view === 'list'}
	<div class="grid gap-2" aria-hidden="true">
		{#each Array(count) as _, i (i)}
			<div class="flex items-center gap-3 rounded-xl border bg-card p-2">
				<Skeleton class="size-12 rounded-lg" />
				<div class="flex-1">
					<Skeleton class="h-4 w-1/2" />
					<Skeleton class="mt-2 h-3 w-1/3" />
				</div>
			</div>
		{/each}
	</div>
{:else}
	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5" aria-hidden="true">
		{#each Array(count) as _, i (i)}
			<div class="overflow-hidden rounded-xl border bg-card">
				<Skeleton class="aspect-square w-full rounded-none" />
				<div class="p-2.5">
					<Skeleton class="h-4 w-3/4" />
					<Skeleton class="mt-1.5 h-3 w-1/2" />
				</div>
			</div>
		{/each}
	</div>
{/if}
