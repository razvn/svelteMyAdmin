import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { explodeMarkup, MediaWikiError, parseMediaWiki } from './mediawiki.ts';
import { extractOdsContent, OdsError, parseOds, parseOdsContent } from './ods.ts';
import { parsePmaXml, XmlFormatError } from './pma-xml.ts';
import { parseXml, textContent, XmlError } from './xml.ts';

describe('parseXml', () => {
	it('parses elements, attributes, entities, CDATA, comments and DOCTYPE', () => {
		const root = parseXml(
			`<?xml version="1.0"?><!DOCTYPE r [<!ENTITY x "y">]><!-- c --><r a="1 &amp; 2" b='&#65;'><k>x &lt; y</k><![CDATA[<raw>]]><e/></r>`
		);
		expect(root.name).toBe('r');
		expect(root.attrs).toEqual({ a: '1 & 2', b: 'A' });
		expect(textContent(root)).toBe('x < y<raw>');
	});
	it('rejects malformed input', () => {
		for (const bad of [
			'<a><b></a>',
			'<a>',
			'',
			'<a/><b/>',
			'<a x=1/>',
			'text',
			'<a>&</a'.slice(0, 5)
		]) {
			expect(() => parseXml(bad), bad).toThrow(XmlError);
		}
	});
});

const CELL = (v: string, extra = '') =>
	`<table:table-cell ${extra} office:value-type="string"><text:p>${v}</text:p></table:table-cell>`;
const odsXml = (body: string) =>
	`<?xml version="1.0"?><office:document-content xmlns:office="o" xmlns:table="t" xmlns:text="x"><office:body><office:spreadsheet>${body}</office:spreadsheet></office:body></office:document-content>`;

describe('ODS', () => {
	const sheet = odsXml(
		`<table:table table:name="People">` +
			`<table:table-row>${CELL('name')}${CELL('age')}${CELL('rate ')}</table:table-row>` +
			`<table:table-row>${CELL('Ann')}<table:table-cell office:value-type="float" office:value="30"><text:p>30</text:p></table:table-cell><table:table-cell office:value-type="percentage" office:value="0.12"><text:p>12%</text:p></table:table-cell></table:table-row>` +
			`<table:table-row>${CELL('Bob')}<table:table-cell/><table:table-cell office:value-type="currency" office:value="5"><text:p>$5.00</text:p></table:table-cell></table:table-row>` +
			`<table:table-row><table:table-cell/><table:table-cell table:number-columns-repeated="3"/></table:table-row>` +
			`</table:table>` +
			`<table:table table:name="Empty"><table:table-row><table:table-cell/></table:table-row></table:table>` +
			`<table:table table:name="Two"><table:table-row>${CELL('a')}<text:p/></table:table-row><table:table-row>${CELL('x&amp;y', 'table:number-columns-repeated="2"')}</table:table-row></table:table>`
	);

	it('sheets become tables; first row names columns; percentages and currency are values', () => {
		const t = parseOdsContent(sheet, { colNames: true });
		expect(t.map((x) => x.name)).toEqual(['People', 'Two']);
		expect(t[0].colNames).toEqual(['name', 'age', 'rate']);
		expect(t[0].rows).toEqual([
			['Ann', '30', '0.12'],
			['Bob', null, '5']
		]);
	});

	it('without column names the first row is data and columns are lettered; empty rows optional', () => {
		const t = parseOdsContent(sheet, { colNames: false, emptyRows: true });
		expect(t[0].colNames).toEqual(['A', 'B', 'C']);
		expect(t[0].rows).toHaveLength(3);
		const keep = parseOdsContent(sheet, { colNames: false, emptyRows: false });
		expect(keep[0].rows).toHaveLength(4);
		expect(keep[0].rows[3]).toEqual([null, null, null]);
	});

	it('percentage and currency recognition can be turned off (display text is used)', () => {
		const t = parseOdsContent(sheet, {
			colNames: true,
			recognizePercentages: false,
			recognizeCurrency: false
		});
		expect(t[0].rows[0][2]).toBe('12%');
		expect(t[0].rows[1][2]).toBe('$5.00');
	});

	it('pads short rows and repeats columns', () => {
		const t = parseOdsContent(sheet, { colNames: false });
		expect(t[1].rows).toEqual([
			['a', null],
			['x&y', 'x&y']
		]);
	});

	it('reads content.xml out of a generated .ods zip', () => {
		const ods = zipSync({
			mimetype: strToU8('application/vnd.oasis.opendocument.spreadsheet'),
			'content.xml': strToU8(sheet)
		});
		expect(extractOdsContent(ods)).toContain('table:name="People"');
		expect(parseOds(ods, { colNames: true })[0].rows).toHaveLength(2);
	});

	it('reports broken input', () => {
		expect(() => parseOds(strToU8('not a zip'))).toThrow(OdsError);
		expect(() => parseOds(zipSync({ 'x.txt': strToU8('hi') }))).toThrow(/Could not parse/);
		expect(() => parseOdsContent('<a>')).toThrow(/malformed/);
		expect(() => parseOdsContent('<a/>')).toThrow(/Could not parse/);
	});
});

describe('phpMyAdmin XML export', () => {
	const xml = `<?xml version="1.0" encoding="utf-8"?>
<pma_xml_export version="1.0" xmlns:pma="https://www.phpmyadmin.net/some_doc_url/">
    <pma:structure_schemas>
        <pma:database name="shop" collation="utf8mb4_general_ci" charset="utf8mb4">
            <pma:table name="items">
                CREATE TABLE \`items\` (
                  \`id\` int NOT NULL,
                  \`name\` varchar(20) DEFAULT NULL
                ) ENGINE=InnoDB;
            </pma:table>
        </pma:database>
    </pma:structure_schemas>
    <database name="shop">
        <!-- Table items -->
        <table name="items">
            <column name="id">1</column>
            <column name="name">Fish &amp; chips</column>
        </table>
        <table name="items">
            <column name="id">2</column>
            <column name="name">NULL</column>
        </table>
    </database>
</pma_xml_export>`;

	it('extracts db, structure and rows', () => {
		const d = parsePmaXml(xml);
		expect(d.dbName).toBe('shop');
		expect(d.charset).toBe('utf8mb4');
		expect(d.collation).toBe('utf8mb4_general_ci');
		expect(d.structure).toHaveLength(1);
		expect(d.structure[0].sql).toMatch(/^CREATE TABLE `items` \(/);
		expect(d.structure[0].sql.endsWith('ENGINE=InnoDB')).toBe(true);
		expect(d.tables).toEqual([
			{
				name: 'items',
				colNames: ['id', 'name'],
				rows: [
					['1', 'Fish & chips'],
					['2', null]
				]
			}
		]);
	});

	it('works without a structure section', () => {
		const d = parsePmaXml(
			`<pma_xml_export><database name="d"><table name="t"><column name="a">1</column></table></database></pma_xml_export>`
		);
		expect(d.structure).toEqual([]);
		expect(d.tables[0].rows).toEqual([['1']]);
	});

	it('rejects malformed XML and files without a database name', () => {
		expect(() => parsePmaXml('<a>')).toThrow(XmlFormatError);
		expect(() => parsePmaXml('<pma_xml_export/>')).toThrow(XmlFormatError);
	});
});

describe('MediaWiki', () => {
	const wiki = `
<!--
Table structure for \`people\`
-->

{| class="wikitable" style="text-align:center;"
|+'''people'''
|-
! Field
! Type
|-
| id
| int
|}

<!--
Table data for \`people\`
-->

{| class="wikitable sortable" style="text-align:center;"
|+'''people'''
|-
 ! id
 ! name
|-
 | 1
 | Ann
|-
 | 2
 | style="color:red" | Bob || extra
|}
`;
	it('skips structure tables and reads data tables with header and row cells', () => {
		const t = parseMediaWiki(wiki);
		expect(t).toHaveLength(1);
		expect(t[0].name).toBe('people');
		expect(t[0].headers).toEqual(['id', 'name']);
		expect(t[0].rows).toEqual([
			['1', 'Ann'],
			['2', 'Bob', 'extra']
		]);
	});

	it('plain tables get no name; inline !! headers and || cells work', () => {
		const t = parseMediaWiki('{|\n! a !! b\n|-\n| 1 || 2\n|}');
		expect(t).toEqual([{ name: '', headers: ['a', 'b'], rows: [['1', '2']] }]);
	});

	it('does not split || inside tags', () => {
		expect(explodeMarkup('| a || <span title="x||y">b</span>')).toEqual([
			'| a ',
			' <span title="x||y">b</span>'
		]);
	});

	it('reports the offending line', () => {
		try {
			parseMediaWiki('{|\n|-\n| 1\nwhat is this\n|}');
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(MediaWikiError);
			expect((e as MediaWikiError).line).toBe(4);
		}
	});
});
