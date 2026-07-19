<script lang="ts">
	import { Skeleton } from '$lib/components/ui/skeleton';

	// mirrors the stats layout (summary tiles + status tiles + a card) so the
	// page doesn't jump when the numbers land
</script>

<div class="grid gap-6" aria-hidden="true">
	<!-- CollectionSummary: four stat tiles -->
	<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
		{#each Array(4) as _, i (i)}
			<div class="rounded-lg border bg-card px-3 py-2">
				<Skeleton class="h-3 w-12" />
				<Skeleton class="mt-1.5 h-4 w-16" />
			</div>
		{/each}
	</div>

	<!-- owned / sold / wishlist tiles -->
	<div class="grid grid-cols-3 gap-2">
		{#each Array(3) as _, i (i)}
			<div class="rounded-lg border bg-card px-3 py-2">
				<Skeleton class="h-3 w-12" />
				<Skeleton class="mt-1.5 h-4 w-8" />
			</div>
		{/each}
	</div>

	<!-- a summary card (e.g. "By collection") -->
	<div class="rounded-xl border bg-card p-6">
		<Skeleton class="h-5 w-32" />
		<div class="mt-4 grid gap-3">
			{#each Array(4) as _, i (i)}
				<div class="flex items-center gap-3">
					<Skeleton class="size-6 rounded-md" />
					<Skeleton class="h-4 flex-1" />
					<Skeleton class="h-4 w-10" />
				</div>
			{/each}
		</div>
	</div>
</div>
