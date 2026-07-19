<script lang="ts">
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { db } from '$lib/db/schema';
	import { live } from '$lib/state/live.svelte';
	import { quickAddFromImage } from '$lib/scan/quickAdd';
	import { startBarcodeScanner } from '$lib/scan/barcode';
	import { processImage } from '$lib/scan/image';
	import { processQueue } from '$lib/ml/queue.svelte';
	import { settings } from '$lib/state/settings.svelte';
	import { addPhoto, bumpQuantity, updateItem } from '$lib/db/repo';
	import CameraCapture from '$lib/components/CameraCapture.svelte';
	import Thumb from '$lib/components/Thumb.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import { Switch } from '$lib/components/ui/switch';
	import { Label } from '$lib/components/ui/label';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import CheckIcon from '@lucide/svelte/icons/check';
	import BarcodeIcon from '@lucide/svelte/icons/barcode';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import ArrowRightIcon from '@lucide/svelte/icons/arrow-right';
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { onDestroy } from 'svelte';
	import type { Item } from '$lib/db/types';

	import { canWrite, collectionRole } from '$lib/state/access.svelte';

	const collectionId = $derived(page.params.id!);

	const collection = $derived(
		live(() => db.collections.get(page.params.id!), undefined, () => page.params.id)
	);

	// view-only grantees can't add items — bounce back to the collection
	$effect(() => {
		if (collection.current && !canWrite(collectionRole(collectionId))) {
			toast.error('This collection is shared with you as view-only');
			void goto(`${base}/collections/${collectionId}`);
		}
	});

	let busy = $state(false);
	let added = $state<{ item: Item; thumb: Blob }[]>([]);
	let pendingBarcode = $state<string | null>(null);
	let stopScanner: (() => void) | null = null;

	// multi-photo mode: several photos accumulate onto one item until "Next item"
	let multiPhoto = $state(settings.multiPhotoScan);
	let current = $state<{ item: Item; count: number } | null>(null);

	onDestroy(() => stopScanner?.());

	function toggleMultiPhoto(v: boolean) {
		multiPhoto = v;
		settings.multiPhotoScan = v;
		settings.save();
		// leaving multi mode finalizes whatever item we were building
		if (!v) current = null;
	}

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

			if (multiPhoto && current) {
				// another photo for the item we're already building
				const processed = await processImage(source);
				const photo = await addPhoto(current.item.id, processed);
				processQueue.enqueue(current.item.id, photo.id);
				if (barcode) await updateItem(current.item.id, { barcode });
				current = { item: current.item, count: current.count + 1 };
				if (navigator.vibrate) navigator.vibrate(20);
				return;
			}

			// start a new item
			const { item, processed } = await quickAddFromImage(collectionId, source, { barcode });
			added = [{ item, thumb: processed.thumb }, ...added].slice(0, 12);
			if (navigator.vibrate) navigator.vibrate(30);

			if (multiPhoto) {
				current = { item, count: 1 };
			} else {
				toast.success('Item added', {
					description: 'Reading text & checking duplicates in the background…',
					action: {
						label: 'Edit details',
						onClick: () => goto(`${base}/items/${item.id}`)
					}
				});
			}
		} catch (err) {
			console.error(err);
			toast.error('Could not save that photo');
		} finally {
			busy = false;
		}
	}

	function nextItem() {
		current = null;
		if (navigator.vibrate) navigator.vibrate(30);
		toast.success('Ready for the next item');
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
				{multiPhoto
					? 'Snap several photos per item, then tap “Next item”.'
					: 'Snap a photo — the item is saved instantly. Keep snapping.'}
			</p>
		</div>
		<Button variant="outline" size="sm" href="{base}/collections/{collectionId}">
			<CheckIcon class="size-4" />
			Done
		</Button>
	</div>

	<!-- scan mode + background-processing status -->
	<div class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/30 px-3 py-2">
		<div class="flex items-center gap-2">
			<Switch
				id="multi-photo"
				checked={multiPhoto}
				onCheckedChange={toggleMultiPhoto}
			/>
			<Label for="multi-photo" class="text-sm">Multiple photos per item</Label>
		</div>
		{#if processQueue.pending}
			<span class="flex items-center gap-1.5 text-xs text-muted-foreground">
				<Loader2Icon class="size-3.5 animate-spin" />
				Processing {processQueue.pending} in background
			</span>
		{/if}
	</div>

	<CameraCapture onCapture={handleSource} onFiles={handleFiles} {onVideoReady} {busy}>
		{#snippet overlay()}
			{#if pendingBarcode}
				<div class="absolute inset-x-0 top-3 flex justify-center px-3">
					<Badge class="gap-1.5 bg-emerald-600 text-white shadow">
						<BarcodeIcon class="size-3.5" />
						{pendingBarcode} — {multiPhoto && current ? 'added to this item' : 'attached to next photo'}
					</Badge>
				</div>
			{/if}
		{/snippet}
	</CameraCapture>

	{#if multiPhoto}
		<div class="mt-3 flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5">
			<p class="min-w-0 flex-1 text-sm">
				{#if current}
					Building an item — <span class="font-medium">{current.count} photo{current.count === 1 ? '' : 's'}</span>.
					Tap the shutter for more.
				{:else}
					Next shutter press starts a new item.
				{/if}
			</p>
			<Button size="sm" onclick={nextItem} disabled={!current}>
				<ArrowRightIcon class="size-4" />
				Next item
			</Button>
		</div>
	{/if}

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
