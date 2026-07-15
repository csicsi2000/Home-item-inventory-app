<script lang="ts">
	import * as Sheet from '$lib/components/ui/sheet';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import Thumb from './Thumb.svelte';
	import { dupAlert } from '$lib/state/dupAlert.svelte';
	import { bumpQuantity, deleteItem, primaryPhoto } from '$lib/db/repo';
	import { base } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import CopyIcon from '@lucide/svelte/icons/copy';

	const pending = $derived(dupAlert.pending);

	let newThumb = $state<Blob | null>(null);
	let existingThumb = $state<Blob | null>(null);
	let merging = $state(false);

	$effect(() => {
		const p = dupAlert.pending;
		newThumb = null;
		existingThumb = null;
		if (!p) return;
		primaryPhoto(p.newItem.id).then((photo) => (newThumb = photo?.thumb ?? photo?.blob ?? null));
		primaryPhoto(p.match.item.id).then(
			(photo) => (existingThumb = photo?.thumb ?? photo?.blob ?? null)
		);
	});

	async function merge() {
		const p = dupAlert.pending;
		if (!p || merging) return;
		merging = true;
		try {
			await bumpQuantity(p.match.item.id, Math.max(1, p.newItem.quantity));
			await deleteItem(p.newItem.id);
			toast.success(
				`Counted as a duplicate of “${p.match.item.name || 'Untitled item'}” — quantity is now ${p.match.item.quantity + Math.max(1, p.newItem.quantity)}`
			);
			dupAlert.pending = null;
		} finally {
			merging = false;
		}
	}

	function keep() {
		dupAlert.pending = null;
	}
</script>

<Sheet.Root
	open={pending !== null}
	onOpenChange={(open) => {
		if (!open) dupAlert.pending = null;
	}}
>
	<Sheet.Content side="bottom" class="mx-auto max-w-lg rounded-t-2xl pb-[env(safe-area-inset-bottom)]">
		{#if pending}
			<Sheet.Header>
				<Sheet.Title class="flex items-center gap-2">
					<CopyIcon class="size-5 text-amber-500" />
					Looks like a duplicate
				</Sheet.Title>
				<Sheet.Description>
					{pending.match.detail} with an item already in this collection.
				</Sheet.Description>
			</Sheet.Header>

			<div class="grid grid-cols-2 gap-3 px-4">
				<div class="text-center">
					<Thumb blob={newThumb} alt="Just scanned" class="aspect-square w-full rounded-lg border" />
					<p class="mt-1 text-xs text-muted-foreground">Just scanned</p>
				</div>
				<div class="text-center">
					<a href="{base}/items/{pending.match.item.id}" onclick={keep}>
						<Thumb blob={existingThumb} alt="Existing item" class="aspect-square w-full rounded-lg border" />
					</a>
					<p class="mt-1 truncate text-xs font-medium">
						{pending.match.item.name || 'Untitled item'}
						<Badge variant="secondary" class="ml-1">×{pending.match.item.quantity}</Badge>
					</p>
				</div>
			</div>

			<Sheet.Footer class="gap-2">
				<Button onclick={merge} disabled={merging}>
					It’s a duplicate — bump quantity
				</Button>
				<Button variant="outline" onclick={keep}>Keep both</Button>
			</Sheet.Footer>
		{/if}
	</Sheet.Content>
</Sheet.Root>
