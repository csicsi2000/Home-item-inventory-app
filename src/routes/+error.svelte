<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import TriangleAlertIcon from '@lucide/svelte/icons/triangle-alert';
	import RotateCwIcon from '@lucide/svelte/icons/rotate-cw';

	// A static SPA has no server to fall back on: without this page an unexpected
	// error in any route leaves the framework's bare error screen with no way back,
	// which on a phone reads as "the app is broken" even though the data is intact.
	const notFound = $derived(page.status === 404);
</script>

<svelte:head><title>{notFound ? 'Not found' : 'Something went wrong'}</title></svelte:head>

<div class="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-20 text-center">
	<TriangleAlertIcon class="size-10 text-muted-foreground" />
	<div>
		<p class="font-medium">
			{notFound ? "That page doesn't exist" : 'Something went wrong'}
		</p>
		<p class="mt-1 text-sm text-muted-foreground">
			{#if notFound}
				The link may be out of date, or the item may have been deleted.
			{:else}
				Your collections are safe on this device — nothing was lost. Reloading usually clears it.
			{/if}
		</p>
		{#if !notFound && page.error?.message}
			<p class="mt-3 rounded-md bg-muted px-3 py-2 text-xs break-words text-muted-foreground">
				{page.error.message}
			</p>
		{/if}
	</div>
	<div class="flex flex-wrap justify-center gap-2">
		{#if !notFound}
			<Button onclick={() => location.reload()}>
				<RotateCwIcon class="size-4" />
				Reload
			</Button>
		{/if}
		<Button variant={notFound ? 'default' : 'outline'} href="{base}/">Back to collections</Button>
	</div>
</div>
