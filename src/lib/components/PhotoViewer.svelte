<script lang="ts">
	import XIcon from '@lucide/svelte/icons/x';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';

	let {
		open = $bindable(false),
		blobs = [],
		index = $bindable(0)
	}: { open?: boolean; blobs?: (Blob | null | undefined)[]; index?: number } = $props();

	// object URLs for the current set, rebuilt whenever the viewer opens
	let urls = $state<(string | null)[]>([]);
	$effect(() => {
		if (!open) return;
		const created = blobs.map((b) => (b ? URL.createObjectURL(b) : null));
		urls = created;
		return () => {
			for (const u of created) if (u) URL.revokeObjectURL(u);
			urls = [];
		};
	});

	const count = $derived(blobs.length);
	const currentUrl = $derived(urls[index] ?? null);

	// zoom + pan state (reset whenever the image changes)
	let zoom = $state(1);
	let panX = $state(0);
	let panY = $state(0);
	$effect(() => {
		index;
		zoom = 1;
		panX = 0;
		panY = 0;
	});

	function close() {
		open = false;
	}
	function next() {
		if (index < count - 1) index++;
	}
	function prev() {
		if (index > 0) index--;
	}
	function toggleZoom() {
		if (zoom > 1) {
			zoom = 1;
			panX = 0;
			panY = 0;
		} else {
			zoom = 2.5;
		}
	}

	$effect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') close();
			else if (e.key === 'ArrowRight') next();
			else if (e.key === 'ArrowLeft') prev();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	});

	// pointer gestures: swipe to change (when not zoomed) / drag to pan (when zoomed)
	let dragging = false;
	let startX = 0;
	let startY = 0;
	let originX = 0;
	let originY = 0;
	let lastTap = 0;

	function onPointerDown(e: PointerEvent) {
		dragging = true;
		startX = e.clientX;
		startY = e.clientY;
		originX = panX;
		originY = panY;
		(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
	}
	function onPointerMove(e: PointerEvent) {
		if (!dragging || zoom === 1) return;
		panX = originX + (e.clientX - startX);
		panY = originY + (e.clientY - startY);
	}
	function onPointerUp(e: PointerEvent) {
		if (!dragging) return;
		dragging = false;
		const dx = e.clientX - startX;
		const dy = e.clientY - startY;
		const moved = Math.abs(dx) + Math.abs(dy);
		if (zoom === 1) {
			if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
				dx < 0 ? next() : prev();
			} else if (moved < 10) {
				// tap: double-tap zooms, single tap does nothing (buttons handle close)
				const now = Date.now();
				if (now - lastTap < 300) toggleZoom();
				lastTap = now;
			}
		}
	}
</script>

{#if open}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-[100] flex touch-none items-center justify-center bg-black/95 select-none"
		style="padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);"
		role="dialog"
		aria-modal="true"
		aria-label="Photo viewer"
	>
		<!-- backdrop: click to close -->
		<button type="button" class="absolute inset-0 cursor-default" aria-label="Close" onclick={close}
		></button>

		{#if currentUrl}
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<img
				src={currentUrl}
				alt=""
				draggable="false"
				class="relative max-h-full max-w-full object-contain transition-transform"
				class:cursor-zoom-in={zoom === 1}
				class:cursor-grab={zoom > 1}
				style="transform: translate({panX}px, {panY}px) scale({zoom});"
				onpointerdown={onPointerDown}
				onpointermove={onPointerMove}
				onpointerup={onPointerUp}
				ondblclick={toggleZoom}
			/>
		{:else}
			<p class="relative text-sm text-white/70">Photo not available offline yet.</p>
		{/if}

		<!-- controls -->
		<button
			type="button"
			class="absolute top-3 right-3 rounded-full bg-white/10 p-2 text-white backdrop-blur transition-colors hover:bg-white/20"
			style="margin-top: env(safe-area-inset-top);"
			onclick={close}
			aria-label="Close"
		>
			<XIcon class="size-6" />
		</button>

		{#if count > 1}
			<div
				class="absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-xs font-medium text-white/90"
				style="margin-top: env(safe-area-inset-top);"
			>
				{index + 1} / {count}
			</div>

			{#if index > 0}
				<button
					type="button"
					class="absolute top-1/2 left-2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white backdrop-blur transition-colors hover:bg-white/20"
					onclick={prev}
					aria-label="Previous photo"
				>
					<ChevronLeftIcon class="size-7" />
				</button>
			{/if}
			{#if index < count - 1}
				<button
					type="button"
					class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white backdrop-blur transition-colors hover:bg-white/20"
					onclick={next}
					aria-label="Next photo"
				>
					<ChevronRightIcon class="size-7" />
				</button>
			{/if}
		{/if}
	</div>
{/if}
