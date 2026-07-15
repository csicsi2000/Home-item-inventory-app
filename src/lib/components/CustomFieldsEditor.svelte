<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	let { fields = $bindable({}) }: { fields?: Record<string, string> } = $props();

	// edit as ordered rows so keys can be renamed without losing focus
	let rows = $state<{ key: string; value: string }[]>(
		Object.entries(fields).map(([key, value]) => ({ key, value }))
	);

	$effect(() => {
		const next: Record<string, string> = {};
		for (const row of rows) {
			const key = row.key.trim();
			if (key) next[key] = row.value;
		}
		fields = next;
	});

	function addRow() {
		rows = [...rows, { key: '', value: '' }];
	}

	function removeRow(index: number) {
		rows = rows.toSpliced(index, 1);
	}
</script>

<div class="grid gap-2">
	{#each rows as row, i (i)}
		<div class="flex gap-2">
			<Input bind:value={row.key} placeholder="Field (e.g. Set)" class="w-2/5" />
			<Input bind:value={row.value} placeholder="Value (e.g. A New Hope)" class="flex-1" />
			<Button variant="ghost" size="icon" type="button" onclick={() => removeRow(i)} aria-label="Remove field">
				<Trash2Icon class="size-4" />
			</Button>
		</div>
	{/each}
	<Button variant="outline" size="sm" type="button" class="justify-self-start" onclick={addRow}>
		<PlusIcon class="size-4" />
		Add field
	</Button>
</div>
