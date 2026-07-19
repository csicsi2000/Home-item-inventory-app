<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Select from '$lib/components/ui/select';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { addShare, listShares, removeShare, setShareRole } from '$lib/sync/shares';
	import { syncNow } from '$lib/sync/engine.svelte';
	import type { RemoteShare, ShareRole } from '$lib/db/types';
	import Trash2Icon from '@lucide/svelte/icons/trash-2';
	import UsersIcon from '@lucide/svelte/icons/users';
	import { toast } from 'svelte-sonner';

	let {
		open = $bindable(false),
		collectionId,
		collectionName
	}: { open?: boolean; collectionId: string; collectionName: string } = $props();

	const roles: { value: ShareRole; label: string; hint: string }[] = [
		{ value: 'read', label: 'Can view', hint: 'Browse items and photos' },
		{ value: 'write', label: 'Can edit', hint: 'Add, edit and delete items' },
		{ value: 'owner', label: 'Owner', hint: 'Everything, including sharing' }
	];
	const roleLabel = (role: ShareRole) => roles.find((r) => r.value === role)?.label ?? role;

	let shares = $state<RemoteShare[]>([]);
	let loading = $state(false);
	let email = $state('');
	let newRole = $state<ShareRole>('read');
	let saving = $state(false);

	async function refresh() {
		loading = true;
		try {
			shares = await listShares(collectionId);
		} catch (err) {
			toast.error('Could not load shares');
			console.error(err);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open) void refresh();
	});

	async function invite(event: SubmitEvent) {
		event.preventDefault();
		if (saving) return;
		saving = true;
		try {
			await addShare(collectionId, email, newRole);
			toast.success(`Shared with ${email.trim().toLowerCase()}`);
			email = '';
			await refresh();
			void syncNow();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not share');
		} finally {
			saving = false;
		}
	}

	async function changeRole(share: RemoteShare, role: ShareRole) {
		if (role === share.role) return;
		try {
			await setShareRole(share.id, role);
			shares = shares.map((s) => (s.id === share.id ? { ...s, role } : s));
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not change the role');
		}
	}

	async function revoke(share: RemoteShare) {
		try {
			await removeShare(share.id);
			shares = shares.filter((s) => s.id !== share.id);
			toast.success(`Removed ${share.granteeEmail}`);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'Could not remove the share');
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[85vh] overflow-y-auto sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				<UsersIcon class="size-4" />
				Share “{collectionName}”
			</Dialog.Title>
			<Dialog.Description>
				People you invite see this collection — including its subfolders — the next time they
				sign in with that email.
			</Dialog.Description>
		</Dialog.Header>

		<form onsubmit={invite} class="grid gap-3">
			<div class="grid gap-2">
				<Label for="share-email">Invite by email</Label>
				<div class="flex gap-2">
					<Input
						id="share-email"
						type="email"
						bind:value={email}
						placeholder="friend@example.com"
						required
						class="flex-1"
					/>
					<Select.Root type="single" bind:value={newRole}>
						<Select.Trigger class="w-28 shrink-0">{roleLabel(newRole)}</Select.Trigger>
						<Select.Content>
							{#each roles as role (role.value)}
								<Select.Item value={role.value} label={role.label}>
									<div class="grid">
										<span>{role.label}</span>
										<span class="text-xs text-muted-foreground">{role.hint}</span>
									</div>
								</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</div>
			</div>
			<Button type="submit" disabled={!email.trim() || saving} class="w-full">
				{saving ? 'Sharing…' : 'Share'}
			</Button>
		</form>

		<div class="grid gap-2">
			<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
				People with access
			</p>
			{#if loading}
				<p class="py-2 text-sm text-muted-foreground">Loading…</p>
			{:else if shares.length === 0}
				<p class="py-2 text-sm text-muted-foreground">Only you have access right now.</p>
			{:else}
				{#each shares as share (share.id)}
					<div class="flex items-center gap-2 rounded-lg border px-3 py-2">
						<p class="min-w-0 flex-1 truncate text-sm">{share.granteeEmail}</p>
						<Select.Root
							type="single"
							value={share.role}
							onValueChange={(v) => changeRole(share, v as ShareRole)}
						>
							<Select.Trigger class="h-8 w-28 shrink-0 text-xs">
								{roleLabel(share.role)}
							</Select.Trigger>
							<Select.Content>
								{#each roles as role (role.value)}
									<Select.Item value={role.value} label={role.label} />
								{/each}
							</Select.Content>
						</Select.Root>
						<Button
							variant="ghost"
							size="icon"
							class="size-8 text-destructive"
							onclick={() => revoke(share)}
							aria-label="Remove access for {share.granteeEmail}"
						>
							<Trash2Icon class="size-4" />
						</Button>
					</div>
				{/each}
			{/if}
		</div>
	</Dialog.Content>
</Dialog.Root>
