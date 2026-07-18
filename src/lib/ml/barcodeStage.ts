import { db } from '$lib/db/schema';
import { updateItem } from '$lib/db/repo';
import type { UUID } from '$lib/db/types';
import { settings } from '$lib/state/settings.svelte';
import { lookupBarcode } from '$lib/scan/lookup';
import { toast } from 'svelte-sonner';
import { base } from '$app/paths';

/**
 * Post-save stage: if the item carries a barcode and online lookup is enabled,
 * pull product data and pre-fill the name/description. Only runs for still-unnamed
 * items, so it never overwrites a name the user (or OCR) set, and it won't keep
 * re-querying the same barcode once a name exists.
 */
export async function barcodeStage(itemId: UUID): Promise<void> {
	if (!settings.onlineBarcodeLookup) return;

	const item = await db.items.get(itemId);
	if (!item || item.deletedAt || !item.barcode) return;
	if (item.name.trim()) return; // already named — don't look up or overwrite

	const info = await lookupBarcode(item.barcode);
	if (!info?.name) return;

	const patch: Parameters<typeof updateItem>[1] = { name: info.name };
	if (!item.description && info.description) patch.description = info.description;

	await updateItem(itemId, patch);
	toast.success(`Found “${info.name}” from the barcode`, {
		action: {
			label: 'Edit',
			onClick: () => {
				location.href = `${base}/items/${itemId}`;
			}
		}
	});
}
