<script lang="ts">
	import { onMount } from 'svelte';
	import { startCamera, stopCamera, grabFrame } from '$lib/scan/camera';
	import { Button } from '$lib/components/ui/button';
	import CameraOffIcon from '@lucide/svelte/icons/camera-off';
	import ImagePlusIcon from '@lucide/svelte/icons/image-plus';
	import type { Snippet } from 'svelte';

	let {
		onCapture,
		onFiles,
		onVideoReady,
		busy = false,
		overlay
	}: {
		/** Shutter pressed — receives the full-res frame. */
		onCapture: (frame: HTMLCanvasElement) => void;
		/** Gallery fallback — receives picked image files. */
		onFiles: (files: File[]) => void;
		/** Fires when the stream is live (used by the barcode scan loop). */
		onVideoReady?: (video: HTMLVideoElement) => void;
		busy?: boolean;
		overlay?: Snippet;
	} = $props();

	let video = $state<HTMLVideoElement | null>(null);
	let fileInput = $state<HTMLInputElement | null>(null);
	let status = $state<'starting' | 'active' | 'error'>('starting');
	let errorMessage = $state('');
	let stream: MediaStream | null = null;

	async function start() {
		if (!video) return;
		status = 'starting';
		try {
			stream = await startCamera(video);
			status = 'active';
			onVideoReady?.(video);
		} catch (err) {
			status = 'error';
			errorMessage =
				err instanceof DOMException && (err.name === 'NotAllowedError' || err.name === 'SecurityError')
					? 'Camera access was denied. You can still add photos from your gallery.'
					: 'Camera is not available here. You can still add photos from your gallery.';
			console.warn('camera start failed', err);
		}
	}

	function stop() {
		stopCamera(stream);
		stream = null;
	}

	onMount(() => {
		start();
		// camera streams die when the tab is backgrounded (esp. iOS) — re-acquire
		const onVisibility = () => {
			if (document.hidden) stop();
			else if (status !== 'error') start();
		};
		document.addEventListener('visibilitychange', onVisibility);
		return () => {
			document.removeEventListener('visibilitychange', onVisibility);
			stop();
		};
	});

	function shutter() {
		if (!video || status !== 'active' || busy) return;
		onCapture(grabFrame(video));
	}

	function pickFiles(event: Event) {
		const input = event.currentTarget as HTMLInputElement;
		const files = Array.from(input.files ?? []);
		input.value = '';
		if (files.length) onFiles(files);
	}
</script>

<div class="relative overflow-hidden rounded-2xl border bg-black">
	<!-- svelte-ignore a11y_media_has_caption -->
	<video
		bind:this={video}
		autoplay
		muted
		playsinline
		class="aspect-[3/4] w-full object-cover sm:aspect-video"
		class:opacity-0={status !== 'active'}
	></video>

	{#if status === 'starting'}
		<div class="absolute inset-0 flex items-center justify-center text-sm text-white/70">
			Starting camera…
		</div>
	{:else if status === 'error'}
		<div class="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
			<CameraOffIcon class="size-8 text-white/60" />
			<p class="text-sm text-white/80">{errorMessage}</p>
			<Button variant="secondary" size="sm" onclick={() => fileInput?.click()}>
				<ImagePlusIcon class="size-4" />
				Choose from gallery
			</Button>
		</div>
	{/if}

	{#if overlay && status === 'active'}
		{@render overlay()}
	{/if}

	{#if status === 'active'}
		<div class="absolute inset-x-0 bottom-0 flex items-center justify-center gap-8 bg-gradient-to-t from-black/60 to-transparent p-4 pt-10">
			<button
				type="button"
				class="rounded-full bg-white/15 p-3 text-white backdrop-blur transition-colors hover:bg-white/25"
				onclick={() => fileInput?.click()}
				aria-label="Add from gallery"
			>
				<ImagePlusIcon class="size-5" />
			</button>
			<button
				type="button"
				class="size-16 rounded-full border-4 border-white bg-white/30 backdrop-blur transition-transform active:scale-90 disabled:opacity-50"
				onclick={shutter}
				disabled={busy}
				aria-label="Take photo"
			></button>
			<span class="size-11"></span>
		</div>
	{/if}
</div>

<input
	bind:this={fileInput}
	type="file"
	accept="image/*"
	multiple
	class="hidden"
	onchange={pickFiles}
/>
