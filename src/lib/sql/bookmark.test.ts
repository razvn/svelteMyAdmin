import { describe, expect, it } from 'vitest';
import { escapeString } from './escape.ts';
import { applyVariables, countVariables, stripVariableComments } from './bookmark.ts';

describe('bookmark variables', () => {
	it('counts every placeholder, including the legacy one', () => {
		expect(countVariables('SELECT 1')).toBe(0);
		expect(countVariables("a = '[VARIABLE1]' AND b = '[VARIABLE2]' OR c = [VARIABLE]")).toBe(3);
	});

	it('removes comments around a placeholder', () => {
		expect(stripVariableComments('x = /* [VARIABLE1] */ 1')).toBe('x =  [VARIABLE1]  1');
		expect(stripVariableComments('/* keep */ SELECT 1')).toBe('/* keep */ SELECT 1');
	});

	it('substitutes escaped values by position', () => {
		const q = "SELECT * FROM t WHERE a = '[VARIABLE1]' AND b = '[VARIABLE2]'";
		expect(applyVariables(q, ['x', "O'Neil"], escapeString)).toBe(
			"SELECT * FROM t WHERE a = 'x' AND b = 'O\\'Neil'"
		);
	});

	it('uses an empty string for missing or empty values', () => {
		expect(
			applyVariables("a = '[VARIABLE1]' b = '[VARIABLE2]'", ['', undefined], escapeString)
		).toBe("a = '' b = ''");
	});

	it('supports the backward compatible [VARIABLE]', () => {
		expect(applyVariables('a = [VARIABLE]', ['7'], escapeString)).toBe('a = 7');
	});

	it('uncomments a placeholder before substituting', () => {
		expect(applyVariables('SELECT 1 /* WHERE id = [VARIABLE1] */', ['5'], escapeString)).toBe(
			'SELECT 1  WHERE id = 5 '
		);
	});
});
