<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import AppShell from '$lib/components/AppShell.svelte';
	import DuplicateAlert from '$lib/components/DuplicateAlert.svelte';
	import { onMount } from 'svelte';
	import { purgeTombstones } from '$lib/db/repo';
	import { initAuth } from '$lib/sync/auth.svelte';
	import { startSyncEngine } from '$lib/sync/engine.svelte';
	import { initPwa } from '$lib/pwa.svelte';

	let { children } = $props();

	onMount(() => {
		// housekeeping: hard-delete old, already-synced tombstones
		purgeTombstones().catch(() => {});
		initAuth();
		startSyncEngine();
		initPwa();
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#09090b" />
</svelte:head>

<ModeWatcher />
<!-- bottom-center keeps toasts clear of the scan screen's top overlays (barcode
     badge); the mobile offset lifts them above the fixed bottom tab bar -->
<Toaster position="bottom-center" mobileOffset={{ bottom: '5rem' }} />
<DuplicateAlert />
<AppShell>
	{@render children()}
</AppShell>
