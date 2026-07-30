<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import { ModeWatcher } from 'mode-watcher';
	import { Toaster } from '$lib/components/ui/sonner';
	import AppShell from '$lib/components/AppShell.svelte';
	import DuplicateAlert from '$lib/components/DuplicateAlert.svelte';
	import { onMount } from 'svelte';
	import { purgeTombstones } from '$lib/db/repo';
	import { maybeRequestPersistence } from '$lib/db/quota.svelte';
	import { initAuth } from '$lib/sync/auth.svelte';
	import { startSyncEngine } from '$lib/sync/engine.svelte';
	import { initPwa } from '$lib/pwa.svelte';
	import { processQueue } from '$lib/ml/queue.svelte';

	let { children } = $props();

	onMount(() => {
		// housekeeping: hard-delete old, already-synced tombstones
		purgeTombstones().catch(() => {});
		// an origin the browser hasn't marked persistent can be evicted wholesale,
		// which in a local-first app is total data loss
		maybeRequestPersistence();
		initAuth();
		const stopSync = startSyncEngine();
		initPwa();

		// resume recognition jobs left over from a previous session, and retry when
		// the network or the tab comes back
		processQueue.start();
		const resume = () => void processQueue.drain();
		window.addEventListener('online', resume);
		document.addEventListener('visibilitychange', resume);

		return () => {
			stopSync();
			window.removeEventListener('online', resume);
			document.removeEventListener('visibilitychange', resume);
		};
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
