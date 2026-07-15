<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { Input } from '$lib/components/ui/input';
	import XIcon from '@lucide/svelte/icons/x';

	let { tags = $bindable([]), id }: { tags?: string[]; id?: string } = $props();

	let draft = $state('');

	function commit() {
		const value = draft.trim().replace(/^#/, '');
		if (value && !tags.includes(value)) tags = [...tags, value];
		draft = '';
	}

	function onkeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			commit();
		} else if (event.key === 'Backspace' && !draft && tags.length) {
			tags = tags.slice(0, -1);
		}
	}

	function remove(tag: string) {
		tags = tags.filter((t) => t !== tag);
	}
</script>

<div class="flex flex-wrap items-center gap-1.5 rounded-md">
	{#if tags.length}
		<div class="flex flex-wrap gap-1.5">
			{#each tags as tag (tag)}
				<Badge variant="secondary" class="gap-1 pr-1">
					{tag}
					<button
						type="button"
						class="rounded-full p-0.5 hover:bg-foreground/10"
						onclick={() => remove(tag)}
						aria-label="Remove tag {tag}"
					>
						<XIcon class="size-3" />
					</button>
				</Badge>
			{/each}
		</div>
	{/if}
	<Input
		{id}
		bind:value={draft}
		{onkeydown}
		onblur={commit}
		placeholder={tags.length ? 'Add another…' : 'e.g. rare, foil, 16GB'}
		class="min-w-32 flex-1"
	/>
</div>
