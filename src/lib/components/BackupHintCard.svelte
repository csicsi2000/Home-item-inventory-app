<script lang="ts">
	import { base } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import { hints } from '$lib/state/hints.svelte';
	import CloudUploadIcon from '@lucide/svelte/icons/cloud-upload';
	import XIcon from '@lucide/svelte/icons/x';
</script>

<div
	class="mb-5 flex items-start gap-3 rounded-xl border border-dashed bg-muted/50 px-4 py-3"
>
	<CloudUploadIcon class="mt-0.5 size-5 shrink-0 text-muted-foreground" />
	<div class="min-w-0 flex-1">
		<p class="text-sm font-medium">Back up your collections</p>
		<p class="mt-0.5 text-xs text-muted-foreground">
			They live only on this device right now. Sign in to back them up and sync across your devices.
		</p>
		<Button size="sm" class="mt-2" href="{base}/settings">Set up backup</Button>
	</div>
	<button
		type="button"
		class="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
		aria-label="Dismiss"
		onclick={() => hints.dismissBackup()}
	>
		<XIcon class="size-4" />
	</button>
</div>
