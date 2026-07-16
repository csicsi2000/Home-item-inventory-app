<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import type { CollectionField } from '$lib/db/types';

	let { fields = $bindable<CollectionField[]>([]) }: { fields?: CollectionField[] } = $props();

	const typeLabels: Record<CollectionField['type'], string> = { text: 'Text', number: 'Number' };

	function addField() {
		fields = [...fields, { id: crypto.randomUUID(), label: '', type: 'text' }];
	}
	function removeField(id: string) {
		fields = fields.filter((f) => f.id !== id);
	}
</script>

<div class="grid gap-2">
	{#each fields as field (field.id)}
		<div class="flex gap-2">
			<Input bind:value={field.label} placeholder="Field name (e.g. Card ID)" class="flex-1" />
			<Select.Root type="single" bind:value={field.type}>
				<Select.Trigger class="w-28">{typeLabels[field.type]}</Select.Trigger>
				<Select.Content>
					<Select.Item value="text" label="Text" />
					<Select.Item value="number" label="Number" />
				</Select.Content>
			</Select.Root>
			<Button variant="ghost" size="icon" type="button" onclick={() => removeField(field.id)} aria-label="Remove field">
				<Trash2Icon class="size-4" />
			</Button>
		</div>
	{/each}
	<Button variant="outline" size="sm" type="button" class="justify-self-start" onclick={addField}>
		<PlusIcon class="size-4" />
		Add field
	</Button>
	{#if fields.length}
		<p class="text-xs text-muted-foreground">
			Every item in this collection will show these fields.
		</p>
	{/if}
</div>
