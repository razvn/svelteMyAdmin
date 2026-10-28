import { XMLValidator } from 'fast-xml-parser';
import { describe, expect, it } from 'vitest';
import xml, { triggerCreateText } from './xml.ts';
import {
	createTestContext,
	fakeConnection,
	field,
	fixtureData,
	makeExportData,
	FIXTURE_FIELDS,
	FIXTURE_ROWS
} from './testing.ts';

const HEADER = [
	'<?xml version="1.0" encoding="utf-8"?>',
	'<!--',
	'- svelteMyAdmin XML Dump',
	'- version 0.0.1',
	'-',
	'- Host: localhost',
	'- Generation Time: October 28, 2026 at 09:41 PM',
	'- Server version: 8.4.4',
	'-->',
	'',
	'<pma_xml_export version="1.0" xmlns:pma="https://www.phpmyadmin.net/some_doc_url/">',
	''
].join('\n');

const BOOKS_CREATE = 'CREATE TABLE `books` (\n  `id` int unsigned NOT NULL\n) ENGINE=InnoDB';

function metadataConnection(extra: [string, Record<string, unknown>[]][] = []) {
	return fakeConnection([
		['SHOW CREATE TABLE', [{ Table: 'books', 'Create Table': BOOKS_CREATE }]],
		['information_schema.TRIGGERS', []],
		['information_schema.SCHEMATA', [{ charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' }]],
		...extra
	]);
}

describe('xml plugin', () => {
	it('has the phpMyAdmin identity and no raw scope', () => {
		expect(xml.id).toBe('xml');
		expect(xml.extension).toBe('xml');
		expect(xml.mimeType).toBe('text/xml');
		expect(xml.scopes).toEqual(['database', 'table']);
		expect(xml.supports).toEqual({ structure: true, data: true });
	});

	it('writes the header, database wrapper, table rows and footer', async () => {
		const t = createTestContext({});
		await xml.header?.(t.ctx);
		await xml.dbHeader?.(t.ctx, 'sma_test', '');
		await xml.data?.(t.ctx, fixtureData());
		await xml.dbFooter?.(t.ctx, 'sma_test');
		await xml.footer?.(t.ctx);
		expect(t.text()).toBe(
			HEADER +
				[
					'    <!--',
					"    - Database: 'sma_test'",
					'    -->',
					'    <database name="sma_test">',
					'        <!-- Table books -->',
					'        <table name="books">',
					'            <column name="id">1</column>',
					'            <column name="name">Plain</column>',
					'            <column name="note">simple</column>',
					'            <column name="price">9.99</column>',
					'            <column name="payload">bin</column>',
					'        </table>',
					'        <table name="books">',
					'            <column name="id">2</column>',
					'            <column name="name">Quote &quot;x&quot;, semi;colon</column>',
					'            <column name="note">line one\nline two\r\nline three</column>',
					'            <column name="price">NULL</column>',
					'            <column name="payload">NULL</column>',
					'        </table>',
					'        <table name="books">',
					'            <column name="id">3</column>',
					'            <column name="name">Ünïcode ✓ 日本</column>',
					'            <column name="note">tab\there\\back</column>',
					'            <column name="price">0</column>',
					'            <column name="payload">q&quot;\nz</column>',
					'        </table>',
					'        <table name="books">',
					'            <column name="id">4</column>',
					'            <column name="name">Apos &#039; &amp; &lt;tag&gt;</column>',
					'            <column name="note"></column>',
					'            <column name="price">-12.50</column>',
					'            <column name="payload"></column>',
					'        </table>',
					'    </database>',
					'</pma_xml_export>'
				].join('\n')
		);
		expect(XMLValidator.validate(t.text())).toBe(true);
	});

	it('writes the structure schemas for a table with the create statement indented', async () => {
		const t = createTestContext({}, { conn: metadataConnection() });
		await xml.structure?.(t.ctx, fixtureData().ref, 'structure');
		expect(t.text()).toBe(
			[
				'    <!--',
				'    - Structure schemas',
				'    -->',
				'    <pma:structure_schemas>',
				'        <pma:database name="sma_test" collation="utf8mb4_unicode_ci" charset="utf8mb4">',
				'            <pma:table name="books">',
				'                CREATE TABLE `books` (',
				'                  `id` int unsigned NOT NULL',
				'                ) ENGINE=InnoDB;',
				'            </pma:table>',
				'        </pma:database>',
				'    </pma:structure_schemas>',
				'',
				''
			].join('\n')
		);
	});

	it('skips tables and views when their object options are off', async () => {
		const t = createTestContext({ export_tables: false, export_views: true });
		await xml.structure?.(t.ctx, fixtureData().ref, 'structure');
		expect(t.text()).toBe('');
	});

	it('exports stored functions with their definitions when routines are on', async () => {
		const conn = fakeConnection([
			['information_schema.ROUTINES', [{ name: 'f1' }]],
			[
				'SHOW CREATE FUNCTION',
				[{ Function: 'f1', 'Create Function': 'CREATE FUNCTION `f1`() RETURNS int\nRETURN 1 ' }]
			],
			['information_schema.SCHEMATA', [{ charset: 'utf8mb4', collation: 'utf8mb4_unicode_ci' }]]
		]);
		const t = createTestContext({ export_procedures: false, export_events: false }, { conn });
		await xml.routines?.(t.ctx, 'sma_test');
		expect(t.text()).toBe(
			[
				'    <!--',
				'    - Structure schemas',
				'    -->',
				'    <pma:structure_schemas>',
				'        <pma:database name="sma_test" collation="utf8mb4_unicode_ci" charset="utf8mb4">',
				'            <pma:function name="f1">',
				'                CREATE FUNCTION `f1`() RETURNS int',
				'                RETURN 1',
				'            </pma:function>',
				'        </pma:database>',
				'    </pma:structure_schemas>',
				'',
				''
			].join('\n')
		);
	});

	it('wraps triggers as CREATE TRIGGER text', () => {
		expect(
			triggerCreateText(
				{
					name: 't1',
					timing: 'BEFORE',
					event: 'INSERT',
					table: 'books',
					statement: 'SET NEW.x = 1'
				},
				(name) => '`' + name + '`'
			)
		).toBe('CREATE TRIGGER `t1` BEFORE INSERT ON `books`\n FOR EACH ROW SET NEW.x = 1');
	});

	it('exports NULL as the text NULL and escapes markup in names and values', async () => {
		const t = createTestContext({});
		await xml.data?.(
			t.ctx,
			makeExportData({
				table: 'a&b',
				fields: [field('x<y', 'varchar')],
				rows: [['<b>"q"</b>'], [null]]
			})
		);
		expect(t.text()).toContain('<column name="x&lt;y">&lt;b&gt;&quot;q&quot;&lt;/b&gt;</column>');
		expect(t.text()).toContain('<column name="x&lt;y">NULL</column>');
	});

	it('stays well formed for the fixture', async () => {
		const t = createTestContext({});
		await xml.header?.(t.ctx);
		await xml.dbHeader?.(t.ctx, 'sma_test', '');
		await xml.data?.(
			t.ctx,
			makeExportData({ table: 'books', fields: FIXTURE_FIELDS, rows: FIXTURE_ROWS })
		);
		await xml.dbFooter?.(t.ctx, 'sma_test');
		await xml.footer?.(t.ctx);
		expect(XMLValidator.validate(t.text())).toBe(true);
	});

	it('uses the metadata connection for the structure hook', async () => {
		const t = createTestContext({}, { conn: metadataConnection() });
		await xml.structure?.(t.ctx, fixtureData().ref, 'structure_and_data');
		expect(t.text()).toContain('<pma:table name="books">');
	});
});
