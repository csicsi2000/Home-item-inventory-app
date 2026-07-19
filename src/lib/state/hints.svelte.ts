/** One-off dismissible UI hints, remembered in localStorage (not synced). */

const KEY = 'ccs-hint-backup-dismissed';

class Hints {
	backupDismissed = $state(read(KEY));

	dismissBackup() {
		this.backupDismissed = true;
		if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, '1');
	}
}

function read(key: string): boolean {
	if (typeof localStorage === 'undefined') return false;
	return localStorage.getItem(key) === '1';
}

export const hints = new Hints();
