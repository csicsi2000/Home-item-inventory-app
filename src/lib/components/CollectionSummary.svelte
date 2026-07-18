<script lang="ts">
	import type { CollectionSummary } from '$lib/summary';
	import { formatMoney } from '$lib/currency';

	let { summary, rolledUp = false }: { summary: CollectionSummary; rolledUp?: boolean } = $props();

	const money = (list: CollectionSummary['value']) =>
		list.length ? list.map((t) => formatMoney(t.total, t.currency)).join(' + ') : '—';
</script>

{#snippet stat(label: string, value: string)}
	<div class="rounded-lg border bg-card px-3 py-2">
		<p class="text-xs text-muted-foreground">{label}</p>
		<p class="mt-0.5 truncate text-sm font-semibold tabular-nums">{value}</p>
	</div>
{/snippet}

<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
	{@render stat('Items', String(summary.items))}
	{@render stat('Pieces', String(summary.pieces))}
	{@render stat(rolledUp ? 'Value (incl. folders)' : 'Value', money(summary.value))}
	{@render stat('Sold', money(summary.sold))}
</div>
