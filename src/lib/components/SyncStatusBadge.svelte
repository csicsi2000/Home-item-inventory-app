<script lang="ts">
	import { syncStatus, syncNow } from '$lib/sync/engine.svelte';
	import { cn } from '$lib/utils.js';
	import CloudIcon from '@lucide/svelte/icons/cloud';
	import CloudOffIcon from '@lucide/svelte/icons/cloud-off';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import CloudAlertIcon from '@lucide/svelte/icons/cloud-alert';

	let { showLabel = true }: { showLabel?: boolean } = $props();

	const label = $derived.by(() => {
		switch (syncStatus.state) {
			case 'disabled':
				return 'Local only';
			case 'signed-out':
				return 'Not signed in';
			case 'syncing':
				return 'Syncing…';
			case 'error':
				return 'Sync error';
			case 'offline':
				return 'Offline';
			default:
				return syncStatus.pendingChanges > 0
					? `${syncStatus.pendingChanges} to sync`
					: 'Synced';
		}
	});
</script>

{#if syncStatus.state !== 'disabled'}
	<button
		type="button"
		class={cn(
			'flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent',
			syncStatus.state === 'error' && 'text-destructive'
		)}
		onclick={() => syncNow()}
		title={syncStatus.error ?? 'Tap to sync now'}
	>
		{#if syncStatus.state === 'syncing'}
			<RefreshCwIcon class="size-4 animate-spin" />
		{:else if syncStatus.state === 'error'}
			<CloudAlertIcon class="size-4" />
		{:else if syncStatus.state === 'offline' || syncStatus.state === 'signed-out'}
			<CloudOffIcon class="size-4" />
		{:else}
			<CloudIcon class="size-4" />
		{/if}
		{#if showLabel}{label}{/if}
	</button>
{/if}
