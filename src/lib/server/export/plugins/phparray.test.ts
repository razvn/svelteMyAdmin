import { describe, expect, it } from 'vitest';
import phparray, { commentString, phpVariableName, varExportValue } from './phparray.ts';
import { createTestContext, fixtureData, makeExportData, FIXTURE_FIELDS } from './testing.ts';

describe('phparray plugin', () => {
	it('has the phpMyAdmin identity and only exports data', () => {
		expect(phparray.id).toBe('phparray');
		expect(phparray.extension).toBe('php');
		expect(phparray.mimeType).toBe('text/plain');
		expect(phparray.supports).toEqual({ structure: false, data: true });
	});

	it('writes a PHP file with the header, database comment and the table array', async () => {
		const t = createTestContext({});
		await phparray.header?.(t.ctx);
		await phparray.dbHeader?.(t.ctx, 'sma_test', '');
		await phparray.data?.(t.ctx, fixtureData());
		expect(t.text()).toBe(
			[
				'<?php',
				'/**',
				' * Export to PHP Array plugin for svelteMyAdmin',
				' * @version 0.0.1',
				' */',
				'',
				'/**',
				' * Database `sma_test`',
				' */',
				'',
				'/* `sma_test`.`books` */',
				'$books = array(',
				"  array('id' => '1','name' => 'Plain','note' => 'simple','price' => '9.99','payload' => 'bin'),",
				"  array('id' => '2','name' => 'Quote \"x\", semi;colon','note' => 'line one\nline two\r\nline three','price' => NULL,'payload' => NULL),",
				"  array('id' => '3','name' => 'Ünïcode ✓ 日本','note' => 'tab\there\\\\back','price' => '0','payload' => 'q\"\nz'),",
				"  array('id' => '4','name' => 'Apos \\' & <tag>','note' => '','price' => '-12.50','payload' => '')",
				');',
				''
			].join('\n')
		);
	});

	it('is valid PHP syntax for the generated arrays (structure check by pattern)', async () => {
		const t = createTestContext({});
		await phparray.data?.(
			t.ctx,
			makeExportData({ table: 'x', fields: FIXTURE_FIELDS.slice(0, 1), rows: [['1']] })
		);
		expect(t.text()).toContain("$x = array(\n  array('id' => '1')\n);\n");
	});

	it('quotes strings with var_export rules and keeps NULL unquoted', () => {
		expect(varExportValue("it's a \\ test").join('')).toBe("'it\\'s a \\\\ test'");
		expect(varExportValue('a\0b').join('')).toBe("'a' . \"\\0\" . 'b'");
		expect(varExportValue(null)).toEqual(['NULL']);
	});

	it('fixes table names into valid PHP variable names', () => {
		expect(phpVariableName('books')).toBe('books');
		expect(phpVariableName('my-table')).toBe('my_table');
		expect(phpVariableName('1st')).toBe('_1st');
		expect(phpVariableName('')).toBe('_');
	});

	it('replaces asterisks in comments like phpMyAdmin strtr', () => {
		expect(commentString('a*b/c')).toBe('a-b/c');
	});

	it('writes an empty array for a table without rows', async () => {
		const t = createTestContext({});
		await phparray.data?.(
			t.ctx,
			makeExportData({ table: 'empty', fields: FIXTURE_FIELDS, rows: [] })
		);
		expect(t.text()).toBe('\n/* `sma_test`.`empty` */\n$empty = array(\n);\n');
	});
});
