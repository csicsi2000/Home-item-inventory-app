<script lang="ts">
	import type { Snippet } from 'svelte';
	import { page } from '$app/state';
	import { base } from '$app/paths';
	import { onNavigate } from '$app/navigation';
	import { prefersReducedMotion } from 'svelte/motion';
	import LayersIcon from '@lucide/svelte/icons/layers';
	import SearchIcon from '@lucide/svelte/icons/search';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import ChartColumnIcon from '@lucide/svelte/icons/chart-column';
	import { cn } from '$lib/utils.js';
	import { morph } from '$lib/state/morph.svelte';
	import SyncStatusBadge from './SyncStatusBadge.svelte';

	let { children }: { children: Snippet } = $props();

	function tabIndexFor(pathname: string): number {
		const exact = tabs.findIndex((t) => t.exact && pathname === t.href);
		// non-exact paths belong to the Collections tab, which owns everything else
		return exact === -1 ? 0 : exact;
	}

	// Picks the flavour of the CSS View Transition (see layout.css):
	//  - 'morph'   a card was tapped → it grows into its detail page
	//  - 'forward' moving down the menu / drilling deeper → slide in from the right
	//  - 'back'    moving up the menu / stepping back → slide in from the left
	function navMode(from: URL, to: URL): 'morph' | 'forward' | 'back' {
		if (morph.id) return 'morph';
		if (morph.back) return 'back';
		const fromTab = tabIndexFor(from.pathname);
		const toTab = tabIndexFor(to.pathname);
		if (fromTab !== toTab) return toTab > fromTab ? 'forward' : 'back';
		const depth = (u: URL) => u.pathname.replace(/\/+$/, '').split('/').filter(Boolean).length;
		return depth(to) < depth(from) ? 'back' : 'forward';
	}

	// Drive navigation with the View Transitions API where supported; browsers
	// without it (or users who prefer reduced motion) just navigate instantly.
	onNavigate((nav) => {
		if (!document.startViewTransition || !nav.from || !nav.to || prefersReducedMotion.current) {
			morph.clear();
			return;
		}
		document.documentElement.dataset.nav = navMode(nav.from.url, nav.to.url);
		morph.back = false; // one-shot hint, consumed
		return new Promise((resolve) => {
			const transition = document.startViewTransition(async () => {
				resolve();
				await nav.complete;
			});
			// drop the morph target once done so nothing lingers on the list view
			transition.finished.finally(() => morph.clear());
		});
	});

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
					'flex flex-1 flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors active:scale-95',
					isActive(tab) ? 'text-primary' : 'text-muted-foreground'
				)}
			>
				<tab.icon class={cn('size-5 transition-transform', isActive(tab) && '-translate-y-0.5')} />
				{tab.label}
			</a>
		{/each}
	</nav>
</div>
