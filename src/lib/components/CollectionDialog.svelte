<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import EmojiPicker from './EmojiPicker.svelte';
	import { createCollection, updateCollection } from '$lib/db/repo';
	import type { Collection } from '$lib/db/types';
	import { toast } from 'svelte-sonner';

	let {
		open = $bindable(false),
		collection = null
	}: { open?: boolean; collection?: Collection | null } = $props();

	let name = $state('');
	let icon = $state('');
	let description = $state('');
	let saving = $state(false);

	$effect(() => {
		if (open) {
			name = collection?.name ?? '';
			icon = collection?.icon ?? '';
			description = collection?.description ?? '';
		}
	});

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim() || saving) return;
		saving = true;
		try {
			const data = {
				name: name.trim(),
				icon: icon.trim() || null,
				description: description.trim() || null
			};
			if (collection) {
				await updateCollection(collection.id, data);
			} else {
				await createCollection(data);
			}
			open = false;
		} catch (err) {
			toast.error('Could not save the collection');
			console.error(err);
		} finally {
			saving = false;
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>{collection ? 'Edit collection' : 'New collection'}</Dialog.Title>
			<Dialog.Description>
				{collection
					? 'Change the name, icon or description.'
					: 'A collection groups related items — cards, electronics, parts…'}
			</Dialog.Description>
		</Dialog.Header>
		<form onsubmit={save} class="grid gap-4">
			<div class="grid grid-cols-[5rem_1fr] gap-3">
				<div class="grid gap-2">
					<Label for="collection-icon">Icon</Label>
					<EmojiPicker bind:value={icon} />
				</div>
				<div class="grid gap-2">
					<Label for="collection-name">Name</Label>
					<!-- svelte-ignore a11y_autofocus -->
					<Input id="collection-name" bind:value={name} placeholder="Star Wars cards" required autofocus />
				</div>
			</div>
			<div class="grid gap-2">
				<Label for="collection-description">Description <span class="text-muted-foreground">(optional)</span></Label>
				<Textarea id="collection-description" bind:value={description} rows={2} />
			</div>
			<Dialog.Footer>
				<Button type="submit" disabled={!name.trim() || saving} class="w-full sm:w-auto">
					{collection ? 'Save changes' : 'Create collection'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
