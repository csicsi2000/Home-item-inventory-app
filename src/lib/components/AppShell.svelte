<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import ChartColumnIcon from '@lucide/svelte/icons/chart-column';
	import { cn } from '$lib/utils.js';
	import SyncStatusBadge from './SyncStatusBadge.svelte';

	let { children }: { children: Snippet } = $props();

	const tabs = [
		{ href: `${base}/`, label: 'Collections', icon: LayersIcon, exact: false },
		{ href: `${base}/search`, label: 'Search', icon: SearchIcon, exact: true },
		{ href: `${base}/stats`, label: 'Stats', icon: ChartColumnIcon, exact: true },
		{ href: `${base}/settings`, label: 'Settings', icon: SettingsIcon, exact: true }
	];

	function isActive(tab: (typeof tabs)[number]): boolean {
		const path = page.url.pathname;
		if (tab.exact) return path === tab.href;
		// Collections tab owns everything that isn't another tab
		return !tabs.some((t) => t.exact && path.startsWith(t.href));
	}
</script>

<div class="flex min-h-dvh">
	<!-- desktop sidebar -->
	<aside class="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r bg-sidebar md:flex">
		<a href="{base}/" class="flex items-center gap-2 px-5 py-5">
			<LayersIcon class="size-6 text-primary" />
			<span class="text-lg font-semibold tracking-tight">Collections</span>
		</a>
		<nav class="flex flex-1 flex-col gap-1 px-3">
			{#each tabs as tab (tab.href)}
				<a
					href={tab.href}
					class={cn(
						'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
						isActive(tab)
							? 'bg-sidebar-accent text-sidebar-accent-foreground'
							: 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
					)}
				>
					<tab.icon class="size-4" />
					{tab.label}
				</a>
			{/each}
		</nav>
		<div class="border-t p-3">
			<SyncStatusBadge />
		</div>
	</aside>

	<!-- content -->
	<main class="min-w-0 flex-1 pb-20 md:pb-0">
		{@render children()}
	</main>

	<!-- mobile bottom tab bar -->
	<nav
		class="fixed inset-x-0 bottom-0 z-40 flex border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden"
		style="padding-bottom: env(safe-area-inset-bottom)"
	>
		{#each tabs as tab (tab.href)}
			<a
				href={tab.href}
				class={cn(
					'flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors',
					isActive(tab) ? 'text-primary' : 'text-muted-foreground'
				)}
			>
				<tab.icon class="size-5" />
				{tab.label}
			</a>
		{/each}
	</nav>
</div>
