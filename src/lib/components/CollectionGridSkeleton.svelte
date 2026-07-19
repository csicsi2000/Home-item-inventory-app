<script lang="ts">
	import { Skeleton } from '$lib/components/ui/skeleton';

	// mirrors the collection card grid so the layout doesn't jump when data lands
	let { count = 8 }: { count?: number } = $props();
</script>

<div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
	{#each Array(count) as _, i (i)}
		<div class="rounded-xl border bg-card py-4">
			<div class="px-4">
				<Skeleton class="size-8 rounded-lg" />
				<Skeleton class="mt-3 h-4 w-3/4" />
				<Skeleton class="mt-2 h-5 w-16 rounded-full" />
			</div>
		</div>
	{/each}
</div>
