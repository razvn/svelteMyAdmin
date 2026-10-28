import { describe, expect, it } from 'vitest';
import { formatSql } from './format';

describe('formatSql', () => {
	it('uppercases keywords, preserves backticks and breaks lines', () => {
		const out = formatSql('select `a`, b from `t` where a = 1', 'mysql');
		expect(out).toContain('SELECT');
		expect(out).toContain('FROM');
		expect(out).toContain('`a`');
		expect(out.split('\n').length).toBeGreaterThan(2);
	});
	it('supports mariadb and leaves empty or unparsable input alone', () => {
		expect(formatSql('select 1', 'mariadb')).toContain('SELECT');
		expect(formatSql('   ')).toBe('   ');
		expect(formatSql("select 'unterminated")).toBeTypeOf('string');
	});
});
