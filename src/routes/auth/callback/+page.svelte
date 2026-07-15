<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { base } from '$app/paths';
	import { supabase } from '$lib/sync/supabase';

	let message = $state('Signing you in…');

	onMount(async () => {
		if (!supabase) {
			await goto(`${base}/`);
			return;
		}
		// supabase-js parses the tokens from the URL hash automatically
		// (detectSessionInUrl) — wait for it to land, then head home.
		for (let attempt = 0; attempt < 40; attempt++) {
			const { data } = await supabase.auth.getSession();
			if (data.session) {
				await goto(`${base}/settings`, { replaceState: true });
				return;
			}
			await new Promise((r) => setTimeout(r, 250));
		}
		message = 'Could not complete sign-in. Please try again from Settings.';
	});
</script>

<div class="flex min-h-[60dvh] items-center justify-center px-4">
	<p class="text-sm text-muted-foreground">{message}</p>
</div>
