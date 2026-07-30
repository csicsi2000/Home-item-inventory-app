/** One-off dismissible UI hints, remembered in localStorage (not synced). */

export type HintKey = 'backup' | 'scan';

const storageKey = (key: HintKey) => `ccs-hint-${key}-dismissed`;

function read(key: HintKey): boolean {
	if (typeof localStorage === 'undefined') return false;
	return localStorage.getItem(storageKey(key)) === '1';
}

class Hints {
	// Keyed rather than one field per hint: every hint is the same
	// show-once-then-remember shape, and adding one shouldn't touch this class.
	#dismissed = $state<Record<HintKey, boolean>>({
		backup: read('backup'),
		scan: read('scan')
	});

	dismissed(key: HintKey): boolean {
		return this.#dismissed[key];
	}

	dismiss(key: HintKey): void {
		this.#dismissed = { ...this.#dismissed, [key]: true };
		if (typeof localStorage !== 'undefined') localStorage.setItem(storageKey(key), '1');
	}

	/** Bring every hint back — used by "reset to defaults" in Settings. */
	resetAll(): void {
		for (const key of Object.keys(this.#dismissed) as HintKey[]) {
			if (typeof localStorage !== 'undefined') localStorage.removeItem(storageKey(key));
		}
		this.#dismissed = { backup: false, scan: false };
	}

	get backupDismissed(): boolean {
		return this.dismissed('backup');
	}

	dismissBackup(): void {
		this.dismiss('backup');
	}
}

export const hints = new Hints();
