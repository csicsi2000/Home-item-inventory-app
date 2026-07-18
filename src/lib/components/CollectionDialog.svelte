<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import EmojiPicker from './EmojiPicker.svelte';
	import CollectionFieldsEditor from './CollectionFieldsEditor.svelte';
	import { createCollection, updateCollection } from '$lib/db/repo';
	import { collectionsLive } from '$lib/state/collections.svelte';
	import { descendantIds, flattenTree } from '$lib/tree';
	import type { Collection, CollectionField } from '$lib/db/types';
	import { toast } from 'svelte-sonner';

	let {
		open = $bindable(false),
		collection = null,
		/** Preselected parent when creating a subcollection. */
		parentId = null
	}: { open?: boolean; collection?: Collection | null; parentId?: string | null } = $props();

	const ROOT = '__root__';

	let name = $state('');
	let icon = $state('');
	let description = $state('');
	let parent = $state(ROOT);
	let fields = $state<CollectionField[]>([]);
	let saving = $state(false);

	// collections that can be a parent here: everything except this one and its own descendants
	const parentOptions = $derived.by(() => {
		const all = collectionsLive.current;
		const excluded = collection ? descendantIds(all, collection.id) : new Set<string>();
		return flattenTree(all).filter((row) => !excluded.has(row.collection.id));
	});
	const parentLabel = $derived(
		parent === ROOT
			? 'Top level'
			: (collectionsLive.current.find((c) => c.id === parent)?.name ?? 'Top level')
	);

	$effect(() => {
		if (open) {
			name = collection?.name ?? '';
			icon = collection?.icon ?? '';
			description = collection?.description ?? '';
			parent = collection?.parentId ?? parentId ?? ROOT;
			// clone so edits don't mutate the live record before saving
			fields = (collection?.fields ?? []).map((f) => ({ ...f }));
		}
	});

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (!name.trim() || saving) return;
		saving = true;
		try {
			const data = {
				name: name.trim(),
				parentId: parent === ROOT ? null : parent,
				icon: icon.trim() || null,
				description: description.trim() || null,
				// keep only named fields
				fields: $state
					.snapshot(fields)
					.map((f) => ({ ...f, label: f.label.trim() }))
					.filter((f) => f.label)
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
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-md">
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
			<div class="grid gap-2">
				<Label>Parent folder</Label>
				<Select.Root type="single" bind:value={parent}>
					<Select.Trigger class="w-full">{parentLabel}</Select.Trigger>
					<Select.Content>
						<Select.Item value={ROOT} label="Top level" />
						{#each parentOptions as row (row.collection.id)}
							<Select.Item value={row.collection.id} label={row.collection.name}>
								<span style="padding-left: {row.depth * 0.75}rem">
									{row.collection.icon ?? '📁'} {row.collection.name}
								</span>
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div class="grid gap-2">
				<Label>Item fields <span class="text-muted-foreground">(optional)</span></Label>
				<CollectionFieldsEditor bind:fields />
			</div>
			<Dialog.Footer>
				<Button type="submit" disabled={!name.trim() || saving} class="w-full sm:w-auto">
					{collection ? 'Save changes' : 'Create collection'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
