import { describe, expect, it } from 'vitest';
import { readSignedClauses, signClause, verifyClause } from './signed-clause.ts';

const S = 'secret';

describe('signed clauses', () => {
	it('round-trips', () => {
		const sig = signClause(S, 'db', 't', '`id` = 1');
		expect(verifyClause(S, 'db', 't', '`id` = 1', sig)).toBe(true);
	});

	it('binds the clause to the db, table and secret', () => {
		const sig = signClause(S, 'db', 't', '`id` = 1');
		expect(verifyClause(S, 'db', 't', '`id` = 2', sig)).toBe(false);
		expect(verifyClause(S, 'db', 'u', '`id` = 1', sig)).toBe(false);
		expect(verifyClause(S, 'db2', 't', '`id` = 1', sig)).toBe(false);
		expect(verifyClause('other', 'db', 't', '`id` = 1', sig)).toBe(false);
	});

	it('rejects missing or malformed signatures', () => {
		expect(verifyClause(S, 'db', 't', '1', null)).toBe(false);
		expect(verifyClause(S, 'db', 't', '1', '')).toBe(false);
		expect(verifyClause(S, 'db', 't', '1', 'not-a-sig')).toBe(false);
	});

	it('reads repeated params and fails closed', () => {
		const a = '`id` = 1';
		const b = '`id` = 2';
		const url = new URL('http://x/?');
		url.searchParams.append('where', a);
		url.searchParams.append('sig', signClause(S, 'db', 't', a));
		url.searchParams.append('where', b);
		url.searchParams.append('sig', signClause(S, 'db', 't', b));
		expect(readSignedClauses(url, S, 'db', 't')).toEqual([a, b]);

		url.searchParams.append('where', '1=1');
		expect(readSignedClauses(url, S, 'db', 't')).toBeNull();

		const filter = new URL('http://x/');
		filter.searchParams.set('filter', 'x > 1');
		filter.searchParams.set('fsig', signClause(S, 'db', 't', 'x > 1'));
		expect(readSignedClauses(filter, S, 'db', 't', 'filter', 'fsig')).toEqual(['x > 1']);
	});
});
