import { describe, expect, it } from 'vitest';
import { EPOCH_CURSOR, advanceCursor, keysetFilter, readCursor, sameCursor } from './cursor';

describe('keysetFilter', () => {
	it('quotes the timestamp so PostgREST does not parse it as filter syntax', () => {
		// a rendered timestamptz contains ':', '.', ',' and '+' — all metacharacters
		const filter = keysetFilter({ ts: '2026-07-30 11:22:33.456789+00', id: 'abc-123' });

		expect(filter).toBe(
			'server_updated_at.gt."2026-07-30 11:22:33.456789+00",' +
				'and(server_updated_at.eq."2026-07-30 11:22:33.456789+00",id.gt."abc-123")'
		);
	});

	it('drops the tiebreaker when there is no id yet', () => {
		expect(keysetFilter(EPOCH_CURSOR)).toBe('server_updated_at.gt."1970-01-01T00:00:00Z"');
	});

	it('escapes quotes and backslashes in values', () => {
		expect(keysetFilter({ ts: 'a"b', id: 'c\\d' })).toContain('id.gt."c\\\\d"');
		expect(keysetFilter({ ts: 'a"b', id: 'c\\d' })).toContain('server_updated_at.gt."a\\"b"');
	});
});

describe('readCursor', () => {
	it('starts at the epoch when a table has never been pulled', () => {
		expect(readCursor(undefined)).toEqual(EPOCH_CURSOR);
	});

	it('treats a pre-keyset cursor as having no id tiebreaker', () => {
		expect(readCursor({ table: 'items', lastPulledAt: '2026-01-01T00:00:00Z' })).toEqual({
			ts: '2026-01-01T00:00:00Z',
			id: null
		});
	});

	it('round-trips a composite cursor', () => {
		const state = { table: 'items', lastPulledAt: '2026-01-01T00:00:00Z', lastPulledId: 'x' };
		expect(readCursor(state)).toEqual({ ts: '2026-01-01T00:00:00Z', id: 'x' });
	});
});

describe('advanceCursor', () => {
	it('moves to the last row of the page', () => {
		const rows = [
			{ id: 'a', server_updated_at: 't1' },
			{ id: 'b', server_updated_at: 't2' }
		];
		expect(advanceCursor(rows, EPOCH_CURSOR)).toEqual({ ts: 't2', id: 'b' });
	});

	it('preserves microsecond precision instead of normalizing through Date', () => {
		const rows = [{ id: 'a', server_updated_at: '2026-07-30 11:22:33.456789+00' }];
		expect(advanceCursor(rows, EPOCH_CURSOR).ts).toBe('2026-07-30 11:22:33.456789+00');
	});

	it('returns the previous cursor for an empty page', () => {
		const prev = { ts: 't1', id: 'a' };
		expect(advanceCursor([], prev)).toBe(prev);
	});

	it('skips trailing rows with no server_updated_at', () => {
		const rows = [
			{ id: 'a', server_updated_at: 't1' },
			{ id: 'b', server_updated_at: null }
		];
		expect(advanceCursor(rows, EPOCH_CURSOR)).toEqual({ ts: 't1', id: 'a' });
	});

	it('signals no progress when the whole page is unusable', () => {
		const prev = { ts: 't1', id: 'a' };
		const rows = [{ id: 'b' }, { id: 'c' }];
		expect(sameCursor(advanceCursor(rows, prev), prev)).toBe(true);
	});
});
