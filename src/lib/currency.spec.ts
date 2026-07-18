import { describe, it, expect } from 'vitest';
import {
	CURRENCY_CODES,
	CURRENCY_OPTIONS,
	currencySymbol,
	formatMoney,
	detectDefaultCurrency
} from './currency';

describe('currency', () => {
	it('returns a symbol string for a known currency', () => {
		expect(typeof currencySymbol('USD')).toBe('string');
		expect(currencySymbol('USD').length).toBeGreaterThan(0);
	});

	it('falls back to the raw code for an invalid currency', () => {
		expect(currencySymbol('NOTACUR')).toBe('NOTACUR');
	});

	it('formats an amount in the given currency', () => {
		expect(formatMoney(12.5, 'USD')).toMatch(/12\.50/);
	});

	it('defaults to USD when the currency is null', () => {
		expect(formatMoney(5, null)).toMatch(/5/);
	});

	it('degrades gracefully on an invalid currency code', () => {
		const out = formatMoney(3, 'NOTACUR');
		expect(out).toContain('3');
		expect(out).toContain('NOTACUR');
	});

	it('exposes one labelled option per code', () => {
		expect(CURRENCY_OPTIONS).toHaveLength(CURRENCY_CODES.length);
		expect(CURRENCY_OPTIONS.every((o) => o.code.length === 3 && o.label.length > 0)).toBe(true);
		expect(CURRENCY_OPTIONS.find((o) => o.code === 'EUR')?.label).toContain('EUR');
	});

	it('detects a plausible 3-letter default currency', () => {
		const cur = detectDefaultCurrency();
		expect(typeof cur).toBe('string');
		expect(cur).toMatch(/^[A-Z]{3}$/);
	});
});
