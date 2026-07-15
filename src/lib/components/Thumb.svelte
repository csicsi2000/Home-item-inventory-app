<script lang="ts">
	import ImageIcon from '@lucide/svelte/icons/image';
	import { cn } from '$lib/utils.js';

	let {
		blob,
		alt = '',
		class: klass = ''
	}: { blob: Blob | null | undefined; alt?: string; class?: string } = $props();

	const url = $derived(blob ? URL.createObjectURL(blob) : null);

	$effect(() => {
		const u = url;
		return () => {
			if (u) URL.revokeObjectURL(u);
		};
	});
</script>

{#if url}
	<img src={url} {alt} class={cn('object-cover', klass)} loading="lazy" />
{:else}
	<div class={cn('flex items-center justify-center bg-muted text-muted-foreground', klass)}>
		<ImageIcon class="size-6" />
	</div>
{/if}
