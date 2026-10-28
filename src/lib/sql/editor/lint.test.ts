import { describe, expect, it } from 'vitest';
import { lintSql } from './lint';

describe('lintSql', () => {
	it('accepts valid SQL, comments and escaped quotes', () => {
		expect(
			lintSql("SELECT 'it''s', \"a\\\"b\", `t``x` FROM (SELECT 1) s -- ) ' \n# (\n/* ( ' */")
		).toEqual([]);
	});
	it('flags unterminated strings and identifiers', () => {
		expect(lintSql("SELECT 'abc")[0]).toMatchObject({
			from: 7,
			message: expect.stringContaining('string')
		});
		expect(lintSql('SELECT `abc')[0].message).toContain('identifier');
	});
	it('flags unbalanced parentheses', () => {
		expect(lintSql('SELECT (1')).toMatchObject([{ from: 7, message: 'Unclosed parenthesis' }]);
		expect(lintSql('SELECT 1)')).toMatchObject([
			{ from: 8, message: 'Unmatched closing parenthesis' }
		]);
	});
	it('flags unterminated block comments', () => {
		expect(lintSql('SELECT 1 /* x')[0].message).toBe('Unterminated comment');
	});
	it('treats -- without a following space as an operator', () => {
		expect(lintSql("SELECT 1--'")).toHaveLength(1);
	});
});
