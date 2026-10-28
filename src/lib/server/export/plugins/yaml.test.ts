import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import yaml, { yamlLine } from './yaml.ts';
import {
	createTestContext,
	field,
	fixtureData,
	makeExportData,
	FIXTURE_FIELDS
} from './testing.ts';

describe('yaml plugin', () => {
	it('has the phpMyAdmin identity and only exports data', () => {
		expect(yaml.id).toBe('yaml');
		expect(yaml.extension).toBe('yml');
		expect(yaml.mimeType).toBe('text/yaml');
		expect(yaml.supports).toEqual({ structure: false, data: true });
	});

	it('writes the documented layout for the fixture', async () => {
		const t = createTestContext({});
		await yaml.header?.(t.ctx);
		await yaml.data?.(t.ctx, fixtureData());
		await yaml.footer?.(t.ctx);
		expect(t.text()).toBe(
			[
				'%YAML 1.1',
				'---',
				'# sma_test.books',
				'-',
				'  id: 1',
				'  name: "Plain"',
				'  note: "simple"',
				'  price: 9.99',
				'  payload: "bin"',
				'-',
				'  id: 2',
				'  name: "Quote \\"x\\", semi;colon"',
				'  note: "line one\\nline two\\r\\nline three"',
				'  price: null',
				'  payload: null',
				'-',
				'  id: 3',
				'  name: "Ünïcode ✓ 日本"',
				'  note: "tab\there\\\\back"',
				'  price: 0',
				'  payload: "q\\"\\nz"',
				'-',
				'  id: 4',
				'  name: "Apos \' & <tag>"',
				'  note: ""',
				'  price: -12.50',
				'  payload: ""',
				'...',
				''
			].join('\n')
		);
	});

	it('parses back to the same values', async () => {
		const t = createTestContext({});
		await yaml.header?.(t.ctx);
		await yaml.data?.(t.ctx, fixtureData());
		await yaml.footer?.(t.ctx);
		const docs = parse(t.text()) as Record<string, unknown>[];
		expect(docs).toHaveLength(4);
		expect(docs[0]).toMatchObject({ id: 1, name: 'Plain', price: 9.99 });
		expect(docs[1]).toMatchObject({ name: 'Quote "x", semi;colon', price: null, payload: null });
		// the YAML escapes decode back to the real line breaks
		expect(docs[1]?.note).toBe('line one\nline two\r\nline three');
		expect(docs[2]).toMatchObject({ name: 'Ünïcode ✓ 日本', price: 0, note: 'tab\there\\back' });
		expect(docs[3]).toMatchObject({ id: 4, price: -12.5, note: '' });
	});

	it('quotes numbers of string columns and leaves text columns quoted when not numeric', () => {
		expect(yamlLine(field('code', 'varchar'), '0042', '\n').join('')).toBe('  code: "0042"\n');
		expect(yamlLine(field('qty', 'int'), '0042', '\n').join('')).toBe('  qty: 0042\n');
		expect(yamlLine(field('note', 'text'), 'hello', '\n').join('')).toBe('  note: "hello"\n');
	});

	it('writes no records for an empty table', async () => {
		const t = createTestContext({});
		await yaml.header?.(t.ctx);
		await yaml.data?.(t.ctx, makeExportData({ fields: FIXTURE_FIELDS, rows: [] }));
		await yaml.footer?.(t.ctx);
		expect(t.text()).toBe('%YAML 1.1\n---\n...\n');
	});
});
