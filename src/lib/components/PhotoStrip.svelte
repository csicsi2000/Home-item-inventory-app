<script lang="ts">
	import { db } from '$lib/db/schema';
	import { addPhoto, deletePhoto } from '$lib/db/repo';
	import { processImage } from '$lib/scan/image';
	import { processQueue } from '$lib/ml/queue.svelte';
	import { live } from '$lib/state/live.svelte';
	import { morph } from '$lib/state/morph.svelte';
	import Thumb from './Thumb.svelte';
	import PhotoViewer from './PhotoViewer.svelte';
	import CameraCapture from './CameraCapture.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import CameraIcon from '@lucide/svelte/icons/camera';
	import XIcon from '@lucide/svelte/icons/x';
	import StarIcon from '@lucide/svelte/icons/star';
	import { toast } from 'svelte-sonner';
	import type { ItemPhoto } from '$lib/db/types';

	let {
		itemId,
		onPhotoAdded,
		heroThumb = null
	}: {
		itemId: string;
		onPhotoAdded?: (photo: ItemPhoto) => void;
		/** Tapped card's photo, shown instantly as the morph target until the real photos load. */
		heroThumb?: Blob | null;
	} = $props();

	const photos = $derived(
		live<ItemPhoto[]>(
			() =>
				db.photos
					.where('itemId')
					.equals(itemId)
					.filter((p) => !p.deletedAt)
					.toArray()
					.then((list) =>
						list.sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt.localeCompare(b.createdAt))
					),
			[],
			() => itemId
		)
	);

	// The primary photo lives in a single persistent slot: while the real photos
	// load it shows the tapped card's photo (heroThumb), then swaps to the actual
	// primary — without remounting, so its `card-thumb` view-transition-name never
	// jumps between elements, which would abort the morph.
	const primaryPhoto = $derived(photos.current[0]);
	const primaryBlob = $derived(
		primaryPhoto ? (primaryPhoto.thumb ?? primaryPhoto.blob) : !photos.loaded ? heroThumb : null
	);
	const restPhotos = $derived(photos.current.slice(1));

	let fileInput = $state<HTMLInputElement | null>(null);
	let busy = $state(false);
	let viewerOpen = $state(false);
	let viewerIndex = $state(0);
	let cameraOpen = $state(false);
	let cameraCount = $state(0);

	// full-res where we have it, thumbnail otherwise — matches the display order
	const viewerBlobs = $derived(photos.current.map((p) => p.blob ?? p.thumb));

	function openViewer(i: number) {
		viewerIndex = i;
		viewerOpen = true;
	}

	async function onFiles(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		if (!files.length) return;
		busy = true;
		try {
			for (const file of files) await savePhoto(file);
		} catch (err) {
			console.error(err);
			toast.error('Could not process that image');
		} finally {
			busy = false;
		}
	}

	/** Process one source into a stored photo and queue background recognition. */
	async function savePhoto(source: Blob | HTMLCanvasElement) {
		const processed = await processImage(source);
		const photo = await addPhoto(itemId, processed);
		processQueue.enqueue(itemId, photo.id);
		onPhotoAdded?.(photo);
		return photo;
	}

	async function onCameraCapture(frame: Blob | HTMLCanvasElement) {
		try {
			await savePhoto(frame);
			cameraCount += 1;
			if (navigator.vibrate) navigator.vibrate(20);
		} catch (err) {
			console.error(err);
			toast.error('Could not save that photo');
		}
	}

	async function onCameraFiles(files: File[]) {
		for (const file of files) await onCameraCapture(file);
	}

	function openCamera() {
		cameraCount = 0;
		cameraOpen = true;
	}

	async function makePrimary(photo: ItemPhoto) {
		const t = new Date().toISOString();
		await db.transaction('rw', db.photos, async () => {
			await db.photos
				.where('itemId')
				.equals(itemId)
				.modify({ isPrimary: false, updatedAt: t, dirty: 1 });
			await db.photos.update(photo.id, { isPrimary: true, updatedAt: t, dirty: 1 });
		});
	}
</script>

{#snippet controls(photo: ItemPhoto)}
	<button
		type="button"
		class="absolute top-1 right-1 rounded-full bg-background/80 p-1 opacity-0 backdrop-blur transition-opacity group-hover:opacity-100"
		onclick={() => deletePhoto(photo.id)}
		aria-label="Delete photo"
	>
		<XIcon class="size-3.5" />
	</button>
	<button
		type="button"
		class="absolute bottom-1 left-1 rounded-full bg-background/80 p-1 backdrop-blur transition-opacity"
		class:opacity-0={!photo.isPrimary}
		class:group-hover:opacity-100={!photo.isPrimary}
		onclick={() => makePrimary(photo)}
		aria-label={photo.isPrimary ? 'Primary photo' : 'Make primary'}
	>
		<StarIcon class={photo.isPrimary ? 'size-3.5 fill-amber-400 text-amber-400' : 'size-3.5'} />
	</button>
{/snippet}

<div class="flex gap-2 overflow-x-auto pb-1">
	{#if primaryBlob}
		<div
			class="group relative shrink-0"
			style:view-transition-name={morph.id === itemId ? 'card-thumb' : undefined}
		>
			<button
				type="button"
				class="block"
				onclick={() => primaryPhoto && openViewer(0)}
				aria-label="View photo full screen"
			>
				<Thumb blob={primaryBlob} alt="" class="size-28 rounded-lg border sm:size-32" />
			</button>
			{#if primaryPhoto}{@render controls(primaryPhoto)}{/if}
		</div>
	{/if}
	{#each restPhotos as photo, j (photo.id)}
		<div class="group relative shrink-0">
			<button
				type="button"
				class="block"
				onclick={() => openViewer(j + 1)}
				aria-label="View photo full screen"
			>
				<Thumb blob={photo.thumb ?? photo.blob} alt="" class="size-28 rounded-lg border sm:size-32" />
			</button>
			{@render controls(photo)}
		</div>
	{/each}
	<Button
		variant="outline"
		class="size-28 shrink-0 flex-col gap-1 rounded-lg border-dashed sm:size-32"
		onclick={openCamera}
		disabled={busy}
	>
		<CameraIcon class="size-5" />
		<span class="text-xs">Take photo</span>
	</Button>
	<Button
		variant="outline"
		class="size-28 shrink-0 flex-col gap-1 rounded-lg border-dashed sm:size-32"
		onclick={() => fileInput?.click()}
		disabled={busy}
	>
		<PlusIcon class="size-5" />
		<span class="text-xs">{busy ? 'Processing…' : 'Add photo'}</span>
	</Button>
	<input
		bind:this={fileInput}
		type="file"
		accept="image/*"
		multiple
		class="hidden"
		onchange={onFiles}
	/>
</div>

<PhotoViewer bind:open={viewerOpen} bind:index={viewerIndex} blobs={viewerBlobs} />

<Dialog.Root bind:open={cameraOpen}>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>Take photos</Dialog.Title>
			<Dialog.Description>
				{cameraCount
					? `${cameraCount} photo${cameraCount === 1 ? '' : 's'} added — keep snapping or close when done.`
					: 'Snap as many photos of this item as you like.'}
			</Dialog.Description>
		</Dialog.Header>
		{#if cameraOpen}
			<CameraCapture onCapture={onCameraCapture} onFiles={onCameraFiles} />
		{/if}
		<Dialog.Footer>
			<Button variant="secondary" onclick={() => (cameraOpen = false)}>Done</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
