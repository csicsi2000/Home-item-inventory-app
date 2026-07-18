/**
 * Opt-in, best-effort online barcode lookup. Only the barcode number ever
 * leaves the device, and only when the user has switched this on in Settings.
 * Every failure (offline, CORS, rate limit, no match) resolves to null so the
 * caller silently falls back to on-device recognition.
 */

export interface BarcodeInfo {
	name?: string;
	description?: string;
	brand?: string;
}

async function fetchJson(url: string, timeoutMs = 5000): Promise<unknown | null> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
		if (!res.ok) return null;
		return await res.json();
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

/** Open Food Facts — free, no key, CORS-enabled. Great for food/drink/household. */
async function lookupOpenFoodFacts(code: string): Promise<BarcodeInfo | null> {
	const data = (await fetchJson(
		`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,generic_name,brands`
	)) as { status?: number; product?: Record<string, string> } | null;
	if (!data || data.status !== 1 || !data.product) return null;
	const p = data.product;
	const name = (p.product_name || p.generic_name || '').trim();
	const brand = (p.brands || '').split(',')[0]?.trim();
	if (!name && !brand) return null;
	return {
		name: name || brand,
		brand: brand || undefined,
		description: [brand, p.generic_name].filter(Boolean).join(' — ') || undefined
	};
}

/** UPCitemdb trial endpoint — no key, CORS-enabled, heavily rate-limited. Generic products. */
async function lookupUpcItemDb(code: string): Promise<BarcodeInfo | null> {
	const data = (await fetchJson(
		`https://api.upcitemdb.com/prod/trial/lookup?upc=${encodeURIComponent(code)}`
	)) as { items?: Array<Record<string, string>> } | null;
	const item = data?.items?.[0];
	if (!item) return null;
	const name = (item.title || '').trim();
	if (!name) return null;
	return {
		name,
		brand: item.brand || undefined,
		description: (item.description || '').trim() || undefined
	};
}

/**
 * Try each source in turn, returning the first hit. Never throws.
 * Skips the network entirely when the browser reports it's offline.
 */
export async function lookupBarcode(code: string): Promise<BarcodeInfo | null> {
	const clean = code.trim();
	if (!clean) return null;
	if (typeof navigator !== 'undefined' && navigator.onLine === false) return null;

	return (await lookupOpenFoodFacts(clean)) ?? (await lookupUpcItemDb(clean));
}
