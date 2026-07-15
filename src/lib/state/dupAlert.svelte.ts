import type { DuplicateMatch } from '$lib/ml/duplicates';
import type { Item } from '$lib/db/types';

export interface PendingDuplicate {
	newItem: Item;
	match: DuplicateMatch;
}

/** Set by the embedding stage when a freshly scanned item looks like a duplicate. */
class DupAlert {
	pending = $state<PendingDuplicate | null>(null);
}

export const dupAlert = new DupAlert();
