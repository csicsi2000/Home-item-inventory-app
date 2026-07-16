<script lang="ts">
	import { Input } from '$lib/components/ui/input';
	import SearchIcon from '@lucide/svelte/icons/search';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';

	let {
		value = $bindable<string>(''),
		placeholder = '📦'
	}: { value?: string; placeholder?: string } = $props();

	interface EmojiEntry {
		unicode: string;
		label: string;
		tags: string[];
		group: number;
		order: number;
	}

	// group.order → display label (skip 2 = skin-tone components)
	const GROUPS: { group: number; label: string }[] = [
		{ group: 0, label: 'Smileys & Emotion' },
		{ group: 1, label: 'People & Body' },
		{ group: 3, label: 'Animals & Nature' },
		{ group: 4, label: 'Food & Drink' },
		{ group: 5, label: 'Travel & Places' },
		{ group: 6, label: 'Activities' },
		{ group: 7, label: 'Objects' },
		{ group: 8, label: 'Symbols' },
		{ group: 9, label: 'Flags' }
	];

	let open = $state(false);
	let query = $state('');
	let all = $state<EmojiEntry[]>([]);
	let loading = $state(false);
	let container = $state<HTMLElement | null>(null);
	let searchInput = $state<HTMLInputElement | null>(null);

	async function ensureLoaded() {
		if (all.length || loading) return;
		loading = true;
		try {
			const data = (await import('emojibase-data/en/compact.json')).default as EmojiEntry[];
			all = data
				.filter((e) => typeof e.group === 'number' && e.group !== 2 && e.unicode)
				.sort((a, b) => a.order - b.order);
		} finally {
			loading = false;
		}
	}

	function toggle() {
		open = !open;
		if (open) {
			ensureLoaded();
			queueMicrotask(() => searchInput?.focus());
		}
	}

	// close on outside click / Escape while open
	$effect(() => {
		if (!open) return;
		const onPointer = (e: PointerEvent) => {
			if (container && !container.contains(e.target as Node)) open = false;
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				open = false;
				e.stopPropagation();
			}
		};
		document.addEventListener('pointerdown', onPointer, true);
		document.addEventListener('keydown', onKey, true);
		return () => {
			document.removeEventListener('pointerdown', onPointer, true);
			document.removeEventListener('keydown', onKey, true);
		};
	});

	const q = $derived(query.trim().toLowerCase());
	const matches = $derived(
		q ? all.filter((e) => e.label.toLowerCase().includes(q) || e.tags?.some((t) => t.includes(q))) : []
	);

	// bucket once per data load rather than filtering all[] nine times per render
	const byGroup = $derived.by(() => {
		const map = new Map<number, EmojiEntry[]>();
		for (const e of all) {
			const list = map.get(e.group);
			if (list) list.push(e);
			else map.set(e.group, [e]);
		}
		return map;
	});

	function pick(emoji: string) {
		value = emoji;
		open = false;
		query = '';
	}

	function clear() {
		value = '';
		open = false;
		query = '';
	}
</script>

<div class="relative" bind:this={container}>
	<button
		type="button"
		onclick={toggle}
		class="flex h-9 w-full items-center justify-center rounded-md border border-input bg-transparent text-2xl shadow-xs transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
		aria-label="Choose an icon"
		aria-expanded={open}
		title="Choose an icon"
	>
		{value || placeholder}
	</button>

	{#if open}
		<div
			class="absolute top-full left-0 z-50 mt-1 w-[19rem] max-w-[calc(100vw-3rem)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md"
		>
			<div class="border-b p-2">
				<div class="relative">
					<SearchIcon class="absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
					<Input bind:ref={searchInput} bind:value={query} placeholder="Search icons…" class="h-9 pl-8" />
				</div>
			</div>

			<div class="h-64 overflow-y-auto overscroll-contain p-2">
				{#if loading && !all.length}
					<p class="py-8 text-center text-sm text-muted-foreground">Loading icons…</p>
				{:else if q}
					{#if matches.length}
						<div class="grid grid-cols-8 gap-0.5">
							{#each matches.slice(0, 240) as e (e.unicode)}
								<button
									type="button"
									class="flex aspect-square items-center justify-center rounded-md text-xl hover:bg-accent"
									title={e.label}
									onclick={() => pick(e.unicode)}
								>
									{e.unicode}
								</button>
							{/each}
						</div>
						{#if matches.length > 240}
							<p class="mt-2 text-center text-xs text-muted-foreground">
								Showing first 240 — keep typing to narrow down
							</p>
						{/if}
					{:else}
						<p class="py-8 text-center text-sm text-muted-foreground">No icons match “{query}”.</p>
					{/if}
				{:else}
					{#each GROUPS as g (g.group)}
						{@const items = byGroup.get(g.group) ?? []}
						{#if items.length}
							<p class="px-1 pt-2 pb-1 text-xs font-medium text-muted-foreground">{g.label}</p>
							<div class="grid grid-cols-8 gap-0.5">
								{#each items as e (e.unicode)}
									<button
										type="button"
										class="flex aspect-square items-center justify-center rounded-md text-xl hover:bg-accent"
										title={e.label}
										onclick={() => pick(e.unicode)}
									>
										{e.unicode}
									</button>
								{/each}
							</div>
						{/if}
					{/each}
				{/if}
			</div>

			{#if value}
				<div class="flex items-center justify-between border-t p-2">
					<span class="flex items-center gap-2 text-sm text-muted-foreground">
						Selected <span class="text-lg">{value}</span>
					</span>
					<button
						type="button"
						class="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
						onclick={clear}
					>
						<Trash2Icon class="size-3.5" /> Clear
					</button>
				</div>
			{/if}
		</div>
	{/if}
</div>
