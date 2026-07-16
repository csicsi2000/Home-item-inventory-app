<script lang="ts">
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { Switch } from '$lib/components/ui/switch';
	import { Slider } from '$lib/components/ui/slider';
	import { Separator } from '$lib/components/ui/separator';
	import SyncStatusBadge from '$lib/components/SyncStatusBadge.svelte';
	import { syncConfigured } from '$lib/sync/supabase';
	import { auth, signInWithGoogle, signInWithMagicLink, signOut } from '$lib/sync/auth.svelte';
	import { syncStatus, syncNow } from '$lib/sync/engine.svelte';
	import { settings } from '$lib/state/settings.svelte';
	import { db } from '$lib/db/schema';
	import { toast } from 'svelte-sonner';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
	import ScanTextIcon from '@lucide/svelte/icons/scan-text';
	import SunIcon from '@lucide/svelte/icons/sun';
	import MoonIcon from '@lucide/svelte/icons/moon';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import SmartphoneIcon from '@lucide/svelte/icons/smartphone';
	import { setMode, userPrefersMode } from 'mode-watcher';
	import { pwa, promptInstall } from '$lib/pwa.svelte';

	let email = $state('');
	let magicSent = $state(false);
	let persisted = $state<boolean | null>(null);
	let reprocessing = $state(false);

	async function reprocessAll() {
		if (reprocessing) return;
		reprocessing = true;
		const id = toast.loading('Preparing to re-scan photos…');
		try {
			const { reprocessAllItems } = await import('$lib/ml/ocrStage');
			const res = await reprocessAllItems((done, total) =>
				toast.loading(`Re-scanning photos… ${done}/${total}`, { id })
			);
			toast.dismiss(id);
			if (res.processed === 0) {
				toast.info('No items with photos to re-scan');
			} else {
				toast.success(
					`Re-scanned ${res.processed} item${res.processed === 1 ? '' : 's'}` +
						(res.named ? ` · auto-named ${res.named}` : '')
				);
			}
		} catch (err) {
			console.error(err);
			toast.dismiss(id);
			toast.error('Re-scan failed');
		} finally {
			reprocessing = false;
		}
	}

	$effect(() => {
		navigator.storage?.persisted?.().then((v) => (persisted = v));
	});

	async function sendMagicLink(event: SubmitEvent) {
		event.preventDefault();
		const { error } = await signInWithMagicLink(email.trim());
		if (error) toast.error(error);
		else magicSent = true;
	}

	async function requestPersist() {
		const granted = await navigator.storage?.persist?.();
		persisted = granted ?? false;
		toast[granted ? 'success' : 'info'](
			granted ? 'Storage is now protected from eviction' : 'Browser declined persistent storage'
		);
	}

	async function exportJson() {
		const [collections, items, photos] = await Promise.all([
			db.collections.filter((c) => !c.deletedAt).toArray(),
			db.items.filter((i) => !i.deletedAt).toArray(),
			db.photos.filter((p) => !p.deletedAt).toArray()
		]);
		const payload = {
			exportedAt: new Date().toISOString(),
			collections,
			items,
			photos: photos.map(({ blob: _b, thumb: _t, ...meta }) => meta)
		};
		const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `collections-export-${new Date().toISOString().slice(0, 10)}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	const pct = (v: number) => `${Math.round(v * 100)}%`;
</script>

<svelte:head><title>Settings</title></svelte:head>

<div class="mx-auto grid max-w-3xl gap-6 px-4 py-6 md:px-8">
	<h1 class="text-2xl font-bold tracking-tight">Settings</h1>

	<Card.Root>
		<Card.Header>
			<Card.Title>Account & sync</Card.Title>
			<Card.Description>
				{#if !syncConfigured}
					This build has no Supabase project configured — everything stays on this device. Add
					PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY to enable cloud sync.
				{:else if auth.session}
					Signed in as {auth.session.user.email}. Your collections sync to every device using this
					account.
				{:else}
					Sign in to back up your collections and use them on other devices. Everything keeps
					working offline.
				{/if}
			</Card.Description>
		</Card.Header>
		{#if syncConfigured}
			<Card.Content class="grid gap-4">
				{#if auth.session}
					<div class="flex flex-wrap items-center gap-3">
						<SyncStatusBadge />
						{#if syncStatus.lastSyncAt}
							<span class="text-xs text-muted-foreground">
								Last sync {new Date(syncStatus.lastSyncAt).toLocaleTimeString()}
							</span>
						{/if}
						<Button size="sm" variant="outline" onclick={() => syncNow()}>Sync now</Button>
						<Button size="sm" variant="ghost" onclick={() => signOut()}>Sign out</Button>
					</div>
					{#if syncStatus.error}
						<p class="text-xs text-destructive">{syncStatus.error}</p>
					{/if}
				{:else}
					<div class="grid gap-3 sm:max-w-sm">
						<Button onclick={() => signInWithGoogle()}>Continue with Google</Button>
						<div class="flex items-center gap-2 text-xs text-muted-foreground">
							<Separator class="flex-1" /> or <Separator class="flex-1" />
						</div>
						{#if magicSent}
							<p class="text-sm text-muted-foreground">
								Check your inbox — the sign-in link brings you back here.
							</p>
						{:else}
							<form onsubmit={sendMagicLink} class="flex gap-2">
								<Input type="email" bind:value={email} placeholder="you@example.com" required />
								<Button type="submit" variant="outline">Email link</Button>
							</form>
						{/if}
					</div>
				{/if}
			</Card.Content>
		{/if}
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Recognition</Card.Title>
			<Card.Description>Everything runs on this device — no photos leave it for recognition.</Card.Description>
		</Card.Header>
		<Card.Content class="grid gap-5">
			<div class="flex items-center justify-between gap-4">
				<div>
					<Label>Read text on new photos (OCR)</Label>
					<p class="text-xs text-muted-foreground">Auto-names items from card titles, part numbers…</p>
				</div>
				<Switch
					checked={settings.autoOcr}
					onCheckedChange={(v) => {
						settings.autoOcr = v;
						settings.save();
					}}
				/>
			</div>
			<div class="flex items-center justify-between gap-4">
				<div>
					<Label>Duplicate detection</Label>
					<p class="text-xs text-muted-foreground">Warns when a new photo matches an existing item.</p>
				</div>
				<Switch
					checked={settings.autoDuplicateCheck}
					onCheckedChange={(v) => {
						settings.autoDuplicateCheck = v;
						settings.save();
					}}
				/>
			</div>
			{#if settings.autoDuplicateCheck}
				<div class="grid gap-2">
					<div class="flex justify-between text-sm">
						<Label>“Likely duplicate” similarity</Label>
						<span class="text-muted-foreground">{pct(settings.dupBlockThreshold)}</span>
					</div>
					<Slider
						type="single"
						min={0.8}
						max={0.99}
						step={0.01}
						value={settings.dupBlockThreshold}
						onValueChange={(v) => {
							settings.dupBlockThreshold = v;
							settings.save();
						}}
					/>
					<p class="text-xs text-muted-foreground">
						Lower it if duplicates slip through; raise it if you get false alarms.
					</p>
				</div>
				<div class="grid gap-2">
					<div class="flex justify-between text-sm">
						<Label>“Similar items” hint</Label>
						<span class="text-muted-foreground">{pct(settings.dupHintThreshold)}</span>
					</div>
					<Slider
						type="single"
						min={0.7}
						max={0.95}
						step={0.01}
						value={settings.dupHintThreshold}
						onValueChange={(v) => {
							settings.dupHintThreshold = v;
							settings.save();
						}}
					/>
				</div>
			{/if}
			<Separator />
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div>
					<Label>Re-scan all photos</Label>
					<p class="text-xs text-muted-foreground">
						Re-read text on every item using the latest recognition, and auto-name items that
						still have no name.
					</p>
				</div>
				<Button variant="outline" size="sm" onclick={reprocessAll} disabled={reprocessing}>
					<ScanTextIcon class="size-4" />
					{reprocessing ? 'Re-scanning…' : 'Re-scan all'}
				</Button>
			</div>
			<Button
				variant="ghost"
				size="sm"
				class="justify-self-start"
				onclick={() => {
					settings.reset();
					toast.success('Recognition settings reset');
				}}
			>
				Reset to defaults
			</Button>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Appearance & app</Card.Title>
		</Card.Header>
		<Card.Content class="grid gap-4">
			<div class="flex items-center justify-between gap-4">
				<Label>Theme</Label>
				<div class="flex gap-1">
					{#each [{ value: 'light', icon: SunIcon, label: 'Light' }, { value: 'dark', icon: MoonIcon, label: 'Dark' }, { value: 'system', icon: MonitorIcon, label: 'System' }] as opt (opt.value)}
						<Button
							variant={userPrefersMode.current === opt.value ? 'default' : 'outline'}
							size="sm"
							onclick={() => setMode(opt.value as 'light' | 'dark' | 'system')}
						>
							<opt.icon class="size-4" />
							<span class="hidden sm:inline">{opt.label}</span>
						</Button>
					{/each}
				</div>
			</div>
			{#if pwa.installPrompt}
				<div class="flex items-center justify-between gap-4">
					<div>
						<Label>Install the app</Label>
						<p class="text-xs text-muted-foreground">Adds it to your home screen, full-screen and offline.</p>
					</div>
					<Button size="sm" onclick={promptInstall}>
						<SmartphoneIcon class="size-4" />
						Install
					</Button>
				</div>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title>Your data</Card.Title>
		</Card.Header>
		<Card.Content class="grid gap-4">
			<div class="flex flex-wrap items-center gap-3">
				<Button variant="outline" onclick={exportJson}>
					<DownloadIcon class="size-4" />
					Export as JSON
				</Button>
				<Button variant="outline" onclick={requestPersist} disabled={persisted === true}>
					<ShieldCheckIcon class="size-4" />
					{persisted ? 'Storage protected' : 'Protect local storage'}
				</Button>
			</div>
			<p class="text-xs text-muted-foreground">
				The export contains collections and item details (photos stay in the app / cloud).
				“Protect local storage” asks the browser not to evict your data under disk pressure.
			</p>
		</Card.Content>
	</Card.Root>
</div>
