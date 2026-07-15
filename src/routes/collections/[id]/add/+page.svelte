<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { db } from '$lib/db/schema';
	import { live } from '$lib/state/live.svelte';
	import { quickAddFromImage } from '$lib/scan/quickAdd';
	import { startBarcodeScanner } from '$lib/scan/barcode';
	import { bumpQuantity } from '$lib/db/repo';
	import CameraCapture from '$lib/components/CameraCapture.svelte';
	import Thumb from '$lib/components/Thumb.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CheckIcon from '@lucide/svelte/icons/check';
	import BarcodeIcon from '@lucide/svelte/icons/barcode';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import type { Item } from '$lib/db/types';

	const collectionId = $derived(page.params.id!);

	const collection = $derived(
		live(() => db.collections.get(page.params.id!), undefined, () => page.params.id)
	);

	let busy = $state(false);
	let added = $state<{ item: Item; thumb: Blob }[]>([]);
	let pendingBarcode = $state<string | null>(null);
	let stopScanner: (() => void) | null = null;

	onDestroy(() => stopScanner?.());

	function onVideoReady(video: HTMLVideoElement) {
		stopScanner?.();
		stopScanner = startBarcodeScanner(video, async (hit) => {
			pendingBarcode = hit.rawValue;
			if (navigator.vibrate) navigator.vibrate([15, 30, 15]);
			// exact-match duplicate: same barcode already in this collection?
			const existing = await db.items
				.where('barcode')
				.equals(hit.rawValue)
				.filter((i) => !i.deletedAt && i.collectionId === collectionId)
				.first();
			if (existing) {
				toast.info(`Already in collection: ${existing.name || 'Untitled item'} ×${existing.quantity}`, {
					action: {
						label: 'Bump quantity',
						onClick: () => {
							bumpQuantity(existing.id);
							pendingBarcode = null;
							toast.success('Quantity increased');
						}
					}
				});
			}
		});
	}

	async function handleSource(source: Blob | HTMLCanvasElement) {
		busy = true;
		try {
			const barcode = pendingBarcode;
			pendingBarcode = null;
			const { item, processed } = await quickAddFromImage(collectionId, source, { barcode });
			added = [{ item, thumb: processed.thumb }, ...added].slice(0, 12);
			if (navigator.vibrate) navigator.vibrate(30);
			toast.success('Item added', {
				description: 'Reading text & checking duplicates in the background…',
				action: {
					label: 'Edit details',
					onClick: () => goto(`${base}/items/${item.id}`)
				}
			});
		} catch (err) {
			console.error(err);
			toast.error('Could not save that photo');
		} finally {
			busy = false;
		}
	}

	async function handleFiles(files: File[]) {
		for (const file of files) await handleSource(file);
	}
</script>

<svelte:head><title>Scan · {collection.current?.name ?? ''}</title></svelte:head>

<div class="mx-auto max-w-2xl px-4 py-4 md:px-8 md:py-6">
	<div class="mb-3 flex items-center gap-3">
		<Button
			variant="ghost"
			size="icon"
			href="{base}/collections/{collectionId}"
			aria-label="Back to collection"
		>
			<ArrowLeftIcon class="size-5" />
		</Button>
		<div class="min-w-0 flex-1">
			<h1 class="truncate text-lg font-bold tracking-tight">
				Scan into {collection.current?.icon ?? ''} {collection.current?.name ?? '…'}
			</h1>
			<p class="text-xs text-muted-foreground">
				Snap a photo — the item is saved instantly. Keep snapping.
			</p>
		</div>
		<Button variant="outline" size="sm" href="{base}/collections/{collectionId}">
			<CheckIcon class="size-4" />
			Done
		</Button>
	</div>

	<CameraCapture onCapture={handleSource} onFiles={handleFiles} {onVideoReady} {busy}>
		{#snippet overlay()}
			{#if pendingBarcode}
				<div class="absolute inset-x-0 top-3 flex justify-center">
					<Badge class="gap-1.5 bg-emerald-600 text-white shadow">
						<BarcodeIcon class="size-3.5" />
						{pendingBarcode} — attached to next photo
					</Badge>
				</div>
			{/if}
		{/snippet}
	</CameraCapture>

	{#if added.length}
		<div class="mt-4">
			<p class="mb-2 text-xs font-medium text-muted-foreground">
				Added this session — tap to edit
			</p>
			<div class="flex gap-2 overflow-x-auto pb-1">
				{#each added as entry (entry.item.id)}
					<a href="{base}/items/{entry.item.id}" class="shrink-0">
						<Thumb blob={entry.thumb} alt="" class="size-20 rounded-lg border" />
					</a>
				{/each}
			</div>
		</div>
	{/if}
</div>
