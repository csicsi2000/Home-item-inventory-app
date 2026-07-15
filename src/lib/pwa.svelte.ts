import { toast } from 'svelte-sonner';

interface BeforeInstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

class PwaState {
	/** non-null when the browser offered an install prompt we deferred */
	installPrompt = $state<BeforeInstallPromptEvent | null>(null);
	installed = $state(false);
}

export const pwa = new PwaState();

export async function promptInstall(): Promise<void> {
	const event = pwa.installPrompt;
	if (!event) return;
	await event.prompt();
	const choice = await event.userChoice;
	if (choice.outcome === 'accepted') {
		pwa.installPrompt = null;
		pwa.installed = true;
	}
}

/** Register the service worker with an update toast, and capture install prompts. */
export async function initPwa(): Promise<void> {
	window.addEventListener('beforeinstallprompt', (event) => {
		event.preventDefault();
		pwa.installPrompt = event as BeforeInstallPromptEvent;
	});
	window.addEventListener('appinstalled', () => {
		pwa.installPrompt = null;
		pwa.installed = true;
	});

	try {
		const { registerSW } = await import('virtual:pwa-register');
		const update = registerSW({
			onNeedRefresh() {
				toast.info('A new version is available', {
					duration: Infinity,
					action: { label: 'Update', onClick: () => update(true) }
				});
			},
			onOfflineReady() {
				toast.success('Ready to work offline');
			}
		});
	} catch {
		// service worker disabled in dev
	}
}
