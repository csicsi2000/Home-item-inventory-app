<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Select from '$lib/components/ui/select';
	import { Separator } from '$lib/components/ui/separator';
	import TagsInput from './TagsInput.svelte';
	import CustomFieldsEditor from './CustomFieldsEditor.svelte';
	import { updateItem } from '$lib/db/repo';
	import type { Item, ItemStatus } from '$lib/db/types';
	import { collectionsLive } from '$lib/state/collections.svelte';
	import { toast } from 'svelte-sonner';

	let { item, autofocusName = false }: { item: Item; autofocusName?: boolean } = $props();

	// editable copy — deliberately NOT reactive to later item changes so typing isn't
	// clobbered; the parent re-mounts the form via {#key item.id} when the item switches
	// svelte-ignore state_referenced_locally
	const initial = item;
	let name = $state(initial.name);
	let description = $state(initial.description ?? '');
	let quantity = $state(initial.quantity);
	let status = $state<ItemStatus>(initial.status);
	let condition = $state(initial.condition ?? '');
	let tags = $state<string[]>([...initial.tags]);
	let barcode = $state(initial.barcode ?? '');
	let acquisitionPrice = $state(initial.acquisitionPrice?.toString() ?? '');
	let acquisitionDate = $state(initial.acquisitionDate ?? '');
	let soldPrice = $state(initial.soldPrice?.toString() ?? '');
	let soldDate = $state(initial.soldDate ?? '');
	let collectionId = $state(initial.collectionId);
	let saving = $state(false);

	const collections = $derived(collectionsLive.current);

	// collection field template for the item's (current) collection
	const templateFields = $derived(collections.find((c) => c.id === collectionId)?.fields ?? []);

	// split the item's stored custom fields into template values vs. ad-hoc extras
	// svelte-ignore state_referenced_locally
	const initialTemplate = collectionsLive.current.find((c) => c.id === initial.collectionId)?.fields ?? [];
	const initialLabels = new Set(initialTemplate.map((f) => f.label));
	let templateValues = $state<Record<string, string>>(
		Object.fromEntries(initialTemplate.map((f) => [f.label, initial.customFields[f.label] ?? '']))
	);
	let extraFields = $state<Record<string, string>>(
		Object.fromEntries(Object.entries(initial.customFields).filter(([k]) => !initialLabels.has(k)))
	);
	const statusLabels: Record<ItemStatus, string> = {
		owned: 'Owned',
		sold: 'Sold',
		wishlist: 'Wishlist'
	};

	const parseNum = (s: string) => {
		const n = parseFloat(s.replace(',', '.'));
		return Number.isFinite(n) ? n : null;
	};

	/** ad-hoc extras first, then non-empty template values (template wins on conflict) */
	function mergedCustomFields(): Record<string, string> {
		const merged: Record<string, string> = {};
		for (const [k, v] of Object.entries($state.snapshot(extraFields))) {
			if (k.trim() && `${v}`.trim()) merged[k] = v;
		}
		for (const f of templateFields) {
			const v = (templateValues[f.label] ?? '').trim();
			if (v) merged[f.label] = v;
		}
		return merged;
	}

	async function save(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		saving = true;
		try {
			await updateItem(item.id, {
				name: name.trim(),
				description: description.trim() || null,
				quantity: Math.max(1, Math.round(Number(quantity) || 1)),
				status,
				condition: condition.trim() || null,
				// $state proxies can't be structured-cloned into IndexedDB
				tags: $state.snapshot(tags),
				barcode: barcode.trim() || null,
				acquisitionPrice: parseNum(acquisitionPrice),
				acquisitionDate: acquisitionDate || null,
				soldPrice: status === 'sold' ? parseNum(soldPrice) : null,
				soldDate: status === 'sold' ? soldDate || new Date().toISOString().slice(0, 10) : null,
				customFields: mergedCustomFields(),
				collectionId
			});
			toast.success('Saved');
		} catch (err) {
			console.error(err);
			toast.error('Could not save the item');
		} finally {
			saving = false;
		}
	}
</script>

<form onsubmit={save} class="grid gap-5">
	<div class="grid gap-2">
		<Label for="item-name">Name</Label>
		<!-- svelte-ignore a11y_autofocus -->
		<Input id="item-name" bind:value={name} placeholder="e.g. Darth Vader — base set" autofocus={autofocusName} />
	</div>

	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
		<div class="grid gap-2">
			<Label for="item-quantity">Quantity</Label>
			<Input id="item-quantity" type="number" min="1" bind:value={quantity} />
		</div>
		<div class="grid gap-2">
			<Label>Status</Label>
			<Select.Root type="single" bind:value={status}>
				<Select.Trigger class="w-full">{statusLabels[status]}</Select.Trigger>
				<Select.Content>
					{#each Object.entries(statusLabels) as [value, label] (value)}
						<Select.Item {value} {label} />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
		<div class="grid gap-2">
			<Label for="item-condition">Condition</Label>
			<Input id="item-condition" bind:value={condition} placeholder="mint, used…" />
		</div>
	</div>

	{#if status === 'sold'}
		<div class="grid grid-cols-2 gap-3 rounded-lg border bg-muted/40 p-3">
			<div class="grid gap-2">
				<Label for="item-sold-price">Sold for</Label>
				<Input id="item-sold-price" inputmode="decimal" bind:value={soldPrice} placeholder="0.00" />
			</div>
			<div class="grid gap-2">
				<Label for="item-sold-date">Sold on</Label>
				<Input id="item-sold-date" type="date" bind:value={soldDate} />
			</div>
		</div>
	{/if}

	<div class="grid gap-2">
		<Label for="item-tags">Tags</Label>
		<TagsInput id="item-tags" bind:tags />
	</div>

	<div class="grid gap-2">
		<Label for="item-description">Notes</Label>
		<Textarea id="item-description" bind:value={description} rows={3} placeholder="Anything worth remembering…" />
	</div>

	<Separator />

	<div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
		<div class="grid gap-2">
			<Label for="item-price">Bought for</Label>
			<Input id="item-price" inputmode="decimal" bind:value={acquisitionPrice} placeholder="0.00" />
		</div>
		<div class="grid gap-2">
			<Label for="item-date">Bought on</Label>
			<Input id="item-date" type="date" bind:value={acquisitionDate} />
		</div>
		<div class="grid gap-2">
			<Label for="item-barcode">Barcode</Label>
			<Input id="item-barcode" bind:value={barcode} placeholder="scan or type" />
		</div>
	</div>

	{#if templateFields.length}
		<div class="grid gap-3 sm:grid-cols-2">
			{#each templateFields as field (field.id)}
				<div class="grid gap-2">
					<Label for="tmpl-{field.id}">{field.label}</Label>
					<Input
						id="tmpl-{field.id}"
						type={field.type === 'number' ? 'number' : 'text'}
						value={templateValues[field.label] ?? ''}
						oninput={(e) => (templateValues[field.label] = e.currentTarget.value)}
					/>
				</div>
			{/each}
		</div>
	{/if}

	<div class="grid gap-2">
		<Label>{templateFields.length ? 'Other fields' : 'Custom fields'}</Label>
		<CustomFieldsEditor bind:fields={extraFields} />
	</div>

	{#if collections.length > 1}
		<div class="grid gap-2">
			<Label>Collection</Label>
			<Select.Root type="single" bind:value={collectionId}>
				<Select.Trigger class="w-full">
					{collections.find((c) => c.id === collectionId)?.name ?? '…'}
				</Select.Trigger>
				<Select.Content>
					{#each collections as c (c.id)}
						<Select.Item value={c.id} label="{c.icon ?? '📦'} {c.name}" />
					{/each}
				</Select.Content>
			</Select.Root>
		</div>
	{/if}

	<div class="sticky bottom-20 z-10 md:bottom-4">
		<Button type="submit" disabled={saving} class="w-full shadow-lg sm:w-auto">
			{saving ? 'Saving…' : 'Save changes'}
		</Button>
	</div>
</form>
