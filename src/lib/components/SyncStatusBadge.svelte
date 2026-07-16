<script lang="ts">
	import * as Popover from '$lib/components/ui/popover';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { syncStatus, syncNow } from '$lib/sync/engine.svelte';
	import { auth, signInWithGoogle, signInWithMagicLink, signOut } from '$lib/sync/auth.svelte';
	import { cn } from '$lib/utils.js';
	import { toast } from 'svelte-sonner';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import LogOutIcon from '@lucide/svelte/icons/log-out';

	let { showLabel = true }: { showLabel?: boolean } = $props();

	let open = $state(false);
	let email = $state('');
	let magicSent = $state(false);

	const signedIn = $derived(!!auth.session);

	const dotColor = $derived.by(() => {
		switch (syncStatus.state) {
			case 'syncing':
				return 'bg-sky-500';
			case 'error':
				return 'bg-destructive';
			case 'offline':
				return 'bg-amber-500';
			case 'signed-out':
				return 'bg-muted-foreground';
			default:
				return syncStatus.pendingChanges > 0 ? 'bg-amber-500' : 'bg-emerald-500';
		}
	});

	const label = $derived.by(() => {
		switch (syncStatus.state) {
			case 'signed-out':
				return 'Not signed in';
			case 'syncing':
				return 'Syncing…';
			case 'error':
				return 'Sync error';
			case 'offline':
				return 'Offline';
			default:
				return syncStatus.pendingChanges > 0 ? `${syncStatus.pendingChanges} to sync` : 'Synced';
		}
	});

	async function sendMagicLink(event: SubmitEvent) {
		event.preventDefault();
		const { error } = await signInWithMagicLink(email.trim());
		if (error) toast.error(error);
		else magicSent = true;
	}
</script>

{#if syncStatus.state !== 'disabled'}
	<Popover.Root bind:open>
		<Popover.Trigger
			class={cn(
				'flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent',
				syncStatus.state === 'error' && 'text-destructive'
			)}
			title={syncStatus.error ?? label}
		>
			<span class="relative flex size-2.5 shrink-0">
				{#if syncStatus.state === 'syncing'}
					<span class="absolute inline-flex size-full animate-ping rounded-full {dotColor} opacity-70"
					></span>
				{/if}
				<span class="relative inline-flex size-2.5 rounded-full {dotColor}"></span>
			</span>
			{#if showLabel}<span class="truncate">{label}</span>{/if}
		</Popover.Trigger>

		<Popover.Content align="start" class="w-64">
			{#if signedIn}
				<div class="grid gap-3">
					<div>
						<p class="text-sm font-medium">{label}</p>
						<p class="truncate text-xs text-muted-foreground">{auth.session?.user.email}</p>
						{#if syncStatus.lastSyncAt}
							<p class="mt-0.5 text-xs text-muted-foreground">
								Last sync {new Date(syncStatus.lastSyncAt).toLocaleTimeString()}
							</p>
						{/if}
						{#if syncStatus.error}
							<p class="mt-1 text-xs text-destructive">{syncStatus.error}</p>
						{/if}
					</div>
					<Button
						size="sm"
						variant="outline"
						onclick={() => {
							syncNow();
							open = false;
						}}
					>
						<RefreshCwIcon class="size-4" />
						Sync now
					</Button>
					<Button
						size="sm"
						variant="ghost"
						class="justify-start text-muted-foreground"
						onclick={() => {
							signOut();
							open = false;
						}}
					>
						<LogOutIcon class="size-4" />
						Sign out
					</Button>
				</div>
			{:else}
				<div class="grid gap-3">
					<div>
						<p class="text-sm font-medium">Sign in to sync</p>
						<p class="text-xs text-muted-foreground">
							Back up your collections and use them on every device. The app keeps working offline
							either way.
						</p>
					</div>
					<Button size="sm" onclick={() => signInWithGoogle()}>Continue with Google</Button>
					<div class="flex items-center gap-2 text-xs text-muted-foreground">
						<span class="h-px flex-1 bg-border"></span> or <span class="h-px flex-1 bg-border"></span>
					</div>
					{#if magicSent}
						<p class="text-xs text-muted-foreground">Check your inbox for the sign-in link.</p>
					{:else}
						<form onsubmit={sendMagicLink} class="grid gap-2">
							<Input type="email" bind:value={email} placeholder="you@example.com" required class="h-9" />
							<Button type="submit" size="sm" variant="outline">Email me a link</Button>
						</form>
					{/if}
				</div>
			{/if}
		</Popover.Content>
	</Popover.Root>
{/if}
