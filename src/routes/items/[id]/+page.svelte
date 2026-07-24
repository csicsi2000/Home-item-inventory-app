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
	import { Skeleton } from '$lib/components/ui/skeleton';
	import * as AlertDialog from '$lib/components/ui/alert-dialog';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import ScanTextIcon from '@lucide/svelte/icons/scan-text';
	import { updateItem } from '$lib/db/repo';
	import { canWrite, collectionRole } from '$lib/state/access.svelte';
	import { morph } from '$lib/state/morph.svelte';
	import { toast } from 'svelte-sonner';

	const itemId = $derived(page.params.id!);
	const isNew = $derived(page.url.searchParams.has('new'));

	const item = $derived(
		live(() => db.items.get(page.params.id!), undefined, () => page.params.id)
	);

	// items in a collection shared with me as read-only can't be edited
	const writable = $derived(
		item.current ? canWrite(collectionRole(item.current.collectionId)) : true
	);

	// The header is always shown (it's the morph target). While the item loads,
	// use the name stashed by the tapped card so it reads correctly from the
	// first frame; on a direct visit (no morph) stay blank rather than flash a
	// wrong placeholder before the real name lands.
	const headerName = $derived(
		item.current
			? item.current.name || (isNew ? 'New item' : 'Untitled item')
			: morph.id === itemId
				? morph.label
				: ''
	);

	// Going back to the collection hits an async-loaded item grid, so a morph
	// target won't be painted in time — slide back instead of a janky delayed
	// morph (the forward tap→grow animation stays as-is).
	function backMorph() {
		morph.back = true;
	}

	let confirmingDelete = $state(false);
	let rescanning = $state(false);
	let nameCandidates = $state<string[]>([]);

	async function rescanText() {
		if (rescanning) return;
		rescanning = true;
		nameCandidates = [];
		const toastId = toast.loading('Reading text on the photos…');
		try {
			const { ocrItem } = await import('$lib/ml/ocrStage');
			const outcome = await ocrItem(itemId);
			toast.dismiss(toastId);
			if (!outcome?.text) {
				toast.info('No readable text found on the photos');
				return;
			}
			// offer the detected names so the user can pick the right one
			nameCandidates = outcome.candidates.filter((c) => c !== item.current?.name);
			if (nameCandidates.length) {
				toast.success('Text updated — pick the name below');
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

	function useAsName(name: string) {
		updateItem(itemId, { name });
		nameCandidates = [];
		toast.success(`Named “${name}”`);
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
	<div class="mb-4 flex items-center gap-3">
		<Button
			variant="ghost"
			size="icon"
			href={item.current ? `${base}/collections/${item.current.collectionId}` : `${base}/`}
			onclick={backMorph}
			aria-label="Back to collection"
		>
			<ArrowLeftIcon class="size-5" />
		</Button>
		<h1
			class="min-w-0 flex-1 truncate text-xl font-bold tracking-tight"
			style:view-transition-name={morph.id === itemId ? 'card-title' : undefined}
		>
			{headerName}
		</h1>
		{#if item.current && !item.current.deletedAt && writable}
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
		{/if}
	</div>

	{#if item.current?.deletedAt}
		<div class="py-16 text-center">
			<p class="font-medium">Item not found</p>
			<Button variant="link" href="{base}/">Back to collections</Button>
		</div>
	{:else}
		{#if item.current && !writable}
			<p class="mb-4 rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
				Shared with you as view-only — editing is disabled.
			</p>
		{/if}

		<!-- Always rendered (never swapped in on load) so the photo's `card-thumb`
		     morph target is a single, stable element for the whole transition —
		     relocating a tracked view-transition-name mid-flight aborts the morph.
		     fieldset[disabled] turns off every input and button inside. -->
		<fieldset disabled={!item.current || !writable} class="mb-6 min-w-0">
			<PhotoStrip {itemId} heroThumb={morph.id === itemId ? morph.thumb : null} />
		</fieldset>

		{#if item.current}
			{#if nameCandidates.length && writable}
			<div class="mb-4 rounded-lg border bg-muted/40 p-3">
				<div class="mb-2 flex items-center justify-between">
					<p class="flex items-center gap-2 text-sm font-medium">
						<ScanTextIcon class="size-4" />
						Set name from photo text
					</p>
					<button
						type="button"
						class="text-xs text-muted-foreground hover:text-foreground"
						onclick={() => (nameCandidates = [])}
					>
						Dismiss
					</button>
				</div>
				<div class="flex flex-wrap gap-2">
					{#each nameCandidates as candidate (candidate)}
						<button
							type="button"
							class="rounded-full border bg-background px-3 py-1.5 text-sm transition-colors hover:bg-accent"
							onclick={() => useAsName(candidate)}
						>
							{candidate}
						</button>
					{/each}
				</div>
			</div>
		{/if}

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
				<fieldset disabled={!writable} class="min-w-0">
					<ItemForm item={item.current} autofocusName={isNew} />
				</fieldset>
			{/key}
		{:else}
			<!-- form fields still loading; the header + photo are already shown above -->
			<div aria-hidden="true" class="grid gap-4">
				{#each Array(5) as _, i (i)}
					<div>
						<Skeleton class="h-3 w-24" />
						<Skeleton class="mt-2 h-9 w-full" />
					</div>
				{/each}
			</div>
		{/if}
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
