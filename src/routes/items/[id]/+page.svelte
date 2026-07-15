<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { goto } from '$app/navigation';
	import { db } from '$lib/db/schema';
	import { deleteItem } from '$lib/db/repo';
	import { live } from '$lib/state/live.svelte';
	import ItemForm from '$lib/components/ItemForm.svelte';
	import PhotoStrip from '$lib/components/PhotoStrip.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ScanTextIcon from '@lucide/svelte/icons/scan-text';
	import { updateItem } from '$lib/db/repo';
	import { toast } from 'svelte-sonner';

	const itemId = $derived(page.params.id!);
	const isNew = $derived(page.url.searchParams.has('new'));

	const item = $derived(
		live(() => db.items.get(page.params.id!), undefined, () => page.params.id)
	);

	let confirmingDelete = $state(false);
	let rescanning = $state(false);

	async function rescanText() {
		if (rescanning) return;
		rescanning = true;
		const toastId = toast.loading('Reading text on the photos…');
		try {
			const { ocrItem } = await import('$lib/ml/ocrStage');
			const outcome = await ocrItem(itemId);
			toast.dismiss(toastId);
			if (!outcome?.text) {
				toast.info('No readable text found');
			} else if (outcome.suggestedName && outcome.suggestedName !== item.current?.name) {
				toast.success('Text updated', {
					description: `Looks like: “${outcome.suggestedName}”`,
					action: {
						label: 'Use as name',
						onClick: () => updateItem(itemId, { name: outcome.suggestedName! })
					}
				});
			} else {
				toast.success('Text updated');
			}
		} catch (err) {
			console.error(err);
			toast.dismiss(toastId);
			toast.error('Text recognition failed');
		} finally {
			rescanning = false;
		}
	}

	async function confirmDelete() {
		const collectionId = item.current?.collectionId;
		await deleteItem(itemId);
		confirmingDelete = false;
		await goto(collectionId ? `${base}/collections/${collectionId}` : `${base}/`);
	}
</script>

<svelte:head><title>{item.current?.name || 'Item'}</title></svelte:head>

<div class="mx-auto max-w-3xl px-4 py-6 md:px-8">
	{#if item.current && !item.current.deletedAt}
		<div class="mb-4 flex items-center gap-3">
			<Button
				variant="ghost"
				size="icon"
				href="{base}/collections/{item.current.collectionId}"
				aria-label="Back to collection"
			>
				<ArrowLeftIcon class="size-5" />
			</Button>
			<h1 class="min-w-0 flex-1 truncate text-xl font-bold tracking-tight">
				{item.current.name || (isNew ? 'New item' : 'Untitled item')}
			</h1>
			<Button
				variant="ghost"
				size="icon"
				onclick={rescanText}
				disabled={rescanning}
				aria-label="Read text on photos"
				title="Read text on photos"
			>
				<ScanTextIcon class="size-5" />
			</Button>
			<Button
				variant="ghost"
				size="icon"
				class="text-destructive"
				onclick={() => (confirmingDelete = true)}
				aria-label="Delete item"
			>
				<Trash2Icon class="size-5" />
			</Button>
		</div>

		<div class="mb-6">
			<PhotoStrip {itemId} />
		</div>

		{#if item.current.ocrText}
			<details class="mb-6 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
				<summary class="flex cursor-pointer items-center gap-2 font-medium">
					<ScanTextIcon class="size-4" />
					Text read from the photos
				</summary>
				<p class="mt-2 whitespace-pre-wrap text-muted-foreground">{item.current.ocrText}</p>
			</details>
		{/if}

		{#key item.current.id}
			<ItemForm item={item.current} autofocusName={isNew} />
		{/key}
	{:else if item.current === undefined}
		<p class="py-16 text-center text-sm text-muted-foreground">Loading…</p>
	{:else}
		<div class="py-16 text-center">
			<p class="font-medium">Item not found</p>
			<Button variant="link" href="{base}/">Back to collections</Button>
		</div>
	{/if}
</div>

<AlertDialog.Root bind:open={confirmingDelete}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete this item?</AlertDialog.Title>
			<AlertDialog.Description>
				“{item.current?.name || 'Untitled item'}” and its photos will be removed from every synced
				device.
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive text-white hover:bg-destructive/90"
				onclick={confirmDelete}
			>
				Delete
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
