<script lang="ts">
	import { db } from '$lib/db/schema';
	import { addPhoto, deletePhoto } from '$lib/db/repo';
	import { processImage } from '$lib/scan/image';
	import { runPostSavePipeline } from '$lib/ml/pipeline';
	import { live } from '$lib/state/live.svelte';
	import Thumb from './Thumb.svelte';
	import { Button } from '$lib/components/ui/button';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import XIcon from '@lucide/svelte/icons/x';
	import StarIcon from '@lucide/svelte/icons/star';
	import { toast } from 'svelte-sonner';
	import type { ItemPhoto } from '$lib/db/types';

	let { itemId, onPhotoAdded }: { itemId: string; onPhotoAdded?: (photo: ItemPhoto) => void } =
		$props();

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

	let fileInput = $state<HTMLInputElement | null>(null);
	let busy = $state(false);

	async function onFiles(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		if (!files.length) return;
		busy = true;
		try {
			for (const file of files) {
				const processed = await processImage(file);
				const photo = await addPhoto(itemId, processed);
				void runPostSavePipeline(itemId, photo.id);
				onPhotoAdded?.(photo);
			}
		} catch (err) {
			console.error(err);
			toast.error('Could not process that image');
		} finally {
			busy = false;
		}
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

<div class="flex gap-2 overflow-x-auto pb-1">
	{#each photos.current as photo (photo.id)}
		<div class="group relative shrink-0">
			<Thumb blob={photo.thumb ?? photo.blob} alt="" class="size-28 rounded-lg border sm:size-32" />
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
		</div>
	{/each}
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
