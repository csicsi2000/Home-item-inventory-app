/** Currency helpers — a curated list for the picker plus locale-aware formatting. */

export const CURRENCY_CODES = [
	'USD',
	'EUR',
	'GBP',
	'CHF',
	'JPY',
	'CNY',
	'CAD',
	'AUD',
	'NZD',
	'SEK',
	'NOK',
	'DKK',
	'PLN',
	'CZK',
	'HUF',
	'RON',
	'INR',
	'BRL',
	'MXN',
	'ZAR',
	'SGD',
	'HKD',
	'KRW',
	'TRY',
	'AED'
] as const;

export type CurrencyCode = (typeof CURRENCY_CODES)[number];

/** Narrow symbol for a currency (e.g. "$", "€", "CHF"), falling back to the code. */
export function currencySymbol(code: string): string {
	try {
		const parts = new Intl.NumberFormat(undefined, {
			style: 'currency',
			currency: code,
			currencyDisplay: 'narrowSymbol'
		}).formatToParts(0);
		return parts.find((p) => p.type === 'currency')?.value ?? code;
	} catch {
		return code;
	}
}

export interface CurrencyOption {
	code: string;
	label: string;
}

/** `[{ code: 'EUR', label: 'EUR · €' }, …]` for the select. */
export const CURRENCY_OPTIONS: CurrencyOption[] = CURRENCY_CODES.map((code) => {
	const sym = currencySymbol(code);
	return { code, label: sym === code ? code : `${code} · ${sym}` };
});

/** Format an amount in a currency, e.g. `formatMoney(12.5, 'EUR')` → "€12.50". */
export function formatMoney(amount: number, code: string | null | undefined): string {
	const currency = code || 'USD';
	try {
		return new Intl.NumberFormat(undefined, {
			style: 'currency',
			currency,
			currencyDisplay: 'narrowSymbol'
		}).format(amount);
	} catch {
		return `${amount} ${currency}`;
	}
}

// A small region→currency map so a fresh install guesses a sensible default from
// the device locale. Anything not listed falls back to USD; the user can change it.
const REGION_TO_CURRENCY: Record<string, string> = {
	US: 'USD',
	GB: 'GBP',
	CH: 'CHF',
	LI: 'CHF',
	JP: 'JPY',
	CN: 'CNY',
	CA: 'CAD',
	AU: 'AUD',
	NZ: 'NZD',
	SE: 'SEK',
	NO: 'NOK',
	DK: 'DKK',
	PL: 'PLN',
	CZ: 'CZK',
	HU: 'HUF',
	RO: 'RON',
	IN: 'INR',
	BR: 'BRL',
	MX: 'MXN',
	ZA: 'ZAR',
	SG: 'SGD',
	HK: 'HKD',
	KR: 'KRW',
	TR: 'TRY',
	AE: 'AED'
	// most of the eurozone resolves via the EU_REGIONS set below
};

const EU_REGIONS = new Set([
	'DE', 'FR', 'IT', 'ES', 'PT', 'NL', 'BE', 'AT', 'IE', 'FI', 'GR', 'SK', 'SI',
	'EE', 'LV', 'LT', 'LU', 'MT', 'CY', 'HR'
]);

/** Best guess for the default currency from the device locale; falls back to USD. */
export function detectDefaultCurrency(): string {
	if (typeof navigator === 'undefined') return 'USD';
	try {
		const region = new Intl.Locale(navigator.language).maximize().region ?? '';
		if (EU_REGIONS.has(region)) return 'EUR';
		return REGION_TO_CURRENCY[region] ?? 'USD';
	} catch {
		return 'USD';
	}
}
