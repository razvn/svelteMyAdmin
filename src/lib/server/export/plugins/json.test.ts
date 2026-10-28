import { describe, expect, it } from 'vitest';
import json, { makeJsonEncoder } from './json.ts';
import {
	createTestContext,
	FIXTURE_FIELDS,
	FIXTURE_ROWS,
	fixtureData,
	makeExportData
} from './testing.ts';

async function exportDb(options: Record<string, string | boolean> = {}) {
	const t = createTestContext(options);
	await json.header?.(t.ctx);
	await json.dbHeader?.(t.ctx, 'sma_test', '');
	await json.data?.(t.ctx, fixtureData());
	await json.footer?.(t.ctx);
	return t.text();
}

describe('json plugin', () => {
	it('has the phpMyAdmin identity', () => {
		expect(json.id).toBe('json');
		expect(json.extension).toBe('json');
		expect(json.mimeType).toBe('text/plain');
		expect(json.supports).toEqual({ structure: false, data: true });
	});

	it('writes the header, database and table elements with numbers as text and binary as hex', async () => {
		const text = await exportDb();
		expect(text).toBe(
			[
				'[',
				'{"type":"header","version":"0.0.1","comment":"Export to JSON plugin for svelteMyAdmin"},',
				'{"type":"database","name":"sma_test"},',
				'{"type":"table","name":"books","database":"sma_test","data":',
				'[',
				'{"id":"1","name":"Plain","note":"simple","price":"9.99","payload":"0x62696e"},',
				'{"id":"2","name":"Quote \\"x\\", semi;colon","note":"line one\\nline two\\r\\nline three","price":null,"payload":null},',
				'{"id":"3","name":"Ünïcode ✓ 日本","note":"tab\\there\\\\back","price":"0","payload":"0x71220a7a"},',
				'{"id":"4","name":"Apos \' & <tag>","note":"","price":"-12.50","payload":"0x"}',
				']',
				'}',
				']',
				''
			].join('\n')
		);
		// header, database and table elements
		expect(JSON.parse(text)).toHaveLength(3);
		expect((JSON.parse(text) as { data: unknown[] }[])[2]?.data).toHaveLength(4);
	});

	it('is valid JSON across several databases and empty tables', async () => {
		const t = createTestContext({});
		await json.header?.(t.ctx);
		await json.dbHeader?.(t.ctx, 'one', '');
		await json.data?.(
			t.ctx,
			makeExportData({ db: 'one', table: 'empty', fields: FIXTURE_FIELDS, rows: [] })
		);
		await json.dbHeader?.(t.ctx, 'two', 'Two alias');
		await json.data?.(
			t.ctx,
			makeExportData({
				db: 'two',
				table: 't',
				alias: 'alias',
				fields: FIXTURE_FIELDS,
				rows: FIXTURE_ROWS
			})
		);
		await json.footer?.(t.ctx);
		const parsed = JSON.parse(t.text()) as Record<string, unknown>[];
		expect(parsed.map((e) => e.type)).toEqual(['header', 'database', 'table', 'database', 'table']);
		expect(parsed[4]).toMatchObject({ name: 'alias', database: 'two' });
		expect((parsed[4] as { data: unknown[] }).data).toHaveLength(4);
	});

	it('writes a header-only export as valid JSON', async () => {
		const t = createTestContext({});
		await json.header?.(t.ctx);
		await json.footer?.(t.ctx);
		expect(JSON.parse(t.text())).toEqual([
			{ type: 'header', version: '0.0.1', comment: 'Export to JSON plugin for svelteMyAdmin' }
		]);
	});

	it('pretty-prints each object with 4 spaces and stays valid JSON', async () => {
		const text = await exportDb({ pretty_print: true });
		expect(text).toContain('    "type": "header",\n    "version": "0.0.1"');
		expect(text).toContain('    "id": "1",\n    "name": "Plain"');
		expect(JSON.parse(text)).toHaveLength(3);
	});

	it('escapes non-ASCII when the unicode option is off (lower-case \\u escapes)', async () => {
		const text = await exportDb({ unicode: false });
		expect(text).toContain('"\\u00dcn\\u00efcode \\u2713 \\u65e5\\u672c"');
		expect(JSON.parse(text)).toHaveLength(3);
	});

	it('keeps unicode unescaped by default', async () => {
		const text = await exportDb();
		expect(text).toContain('Ünïcode ✓ 日本');
	});

	it('writes a raw query as a "raw" element', async () => {
		const t = createTestContext({}, { scope: 'raw' });
		await json.header?.(t.ctx);
		await json.data?.(
			t.ctx,
			makeExportData({ db: '', table: '', fields: [FIXTURE_FIELDS[0]!], rows: [['7']] })
		);
		await json.footer?.(t.ctx);
		expect(JSON.parse(t.text())[1]).toEqual({ type: 'raw', data: [{ id: '7' }] });
	});
});

describe('json encoder', () => {
	it('escapes slashes as PHP does and keeps empty objects compact', () => {
		const encoder = makeJsonEncoder(false, true);
		expect(encoder.str('a/b')).toBe('"a\\/b"');
		expect(encoder.object([])).toBe('{}');
	});
});
