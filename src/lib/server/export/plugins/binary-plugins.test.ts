import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import ods from '#lib/server/export/plugins/ods.ts';
import odt from '#lib/server/export/plugins/odt.ts';
import pdf from '#lib/server/export/plugins/pdf.ts';
import binaryPlugins from '#lib/server/export/plugins/binary-plugins.ts';
import {
	dataOf,
	fakeContext,
	field,
	listZip,
	pdfPageCount,
	pdfText,
	runPlugin,
	unzipText
} from '#lib/server/export/plugins/binary-testing.ts';

const fields = [
	field('id', 'int'),
	field('name', 'varchar'),
	field('price', 'decimal'),
	field('born', 'date'),
	field('at', 'time'),
	field('ts', 'datetime'),
	field('img', 'blob', { isBinary: true }),
	field('geo', 'point', { isBinary: true })
];
const rows = () => [
	[
		'1',
		`Tom & "Jerry" <b> 'é'`,
		'12.50',
		'2024-02-29',
		'-12:34:56',
		'2024-02-29 13:45:10.123',
		Buffer.from([1, 2]),
		Buffer.from([0xde, 0xad])
	],
	['2', null, null, null, null, null, null, null]
];
const quickStructure = {
	query: async (sql: string) =>
		sql.startsWith('SHOW FULL COLUMNS')
			? [
					[
						{ Field: 'id', Type: 'int unsigned', Null: 'NO', Default: null, Comment: 'pk <1>' },
						{ Field: 'a_id', Type: 'int', Null: 'YES', Default: null, Comment: '' }
					]
				]
			: [[{ c: 'a_id', t: 'authors', f: 'id' }]]
};

describe('registry list', () => {
	it('exports ods, odt, pdf as binary plugins', () => {
		expect(binaryPlugins.map((p) => p.id)).toEqual(['ods', 'odt', 'pdf']);
		expect(binaryPlugins.every((p) => p.binary)).toBe(true);
	});
});

describe('ods', () => {
	async function build(options = {}) {
		const fc = fakeContext(options);
		return runPlugin(ods, fc, (ctx) => ods.data!(ctx, dataOf('t', fields, rows())));
	}

	it('writes mimetype first, stored, plus manifest', async () => {
		const zip = await build();
		const entries = listZip(zip);
		expect(entries[0]).toEqual({ name: 'mimetype', method: 0 });
		expect(entries.map((e) => e.name).sort()).toEqual(
			['META-INF/manifest.xml', 'content.xml', 'meta.xml', 'mimetype', 'styles.xml'].sort()
		);
		const files = unzipText(zip);
		expect(files.mimetype).toBe('application/vnd.oasis.opendocument.spreadsheet');
		expect(files['META-INF/manifest.xml']).toContain(
			'manifest:media-type="application/vnd.oasis.opendocument.spreadsheet" manifest:full-path="/"'
		);
		expect(files['meta.xml']).toContain('<meta:creation-date>2024-03-05T10:20:30+00:00');
	});

	it('types cells like PHP and escapes', async () => {
		const x = unzipText(await build({ columns: true, null: '<null>' }))['content.xml'];
		expect(x).toContain('<table:table table:name="t">');
		expect(x).toContain('<text:p>price</text:p>');
		expect(x).toContain('office:value-type="float" office:value="1" ><text:p>1</text:p>');
		expect(x).toContain('office:value="12.50"');
		expect(x).toContain('Tom &amp; &quot;Jerry&quot; &lt;b&gt; &#039;é&#039;');
		expect(x).toContain('office:date-value="2024-02-29" table:style-name="DateCell"');
		expect(x).toContain('office:time-value="-PT12H34M56S" table:style-name="TimeCell"');
		expect(x).toContain('office:date-value="2024-02-29T13:45:10" table:style-name="DateTimeCell"');
		expect(x).toContain('<text:p>0xdead</text:p>');
		expect(x).toContain('<text:p>&lt;null&gt;</text:p>');
		// blob ignored
		expect(x).toContain('<table:table-cell office:value-type="string"><text:p></text:p>');
	});

	it('omits the column row by default and defaults NULL text', async () => {
		const x = unzipText(await build())['content.xml'];
		expect(x).not.toContain('<text:p>price</text:p>');
		expect(x).toContain('<text:p>NULL</text:p>');
	});

	it('is readable by SheetJS', async () => {
		const wb = XLSX.read(await build({ columns: true }), { type: 'array', cellDates: true });
		expect(wb.SheetNames).toEqual(['t']);
		const aoa = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.t, { header: 1, raw: true });
		expect(aoa[0]?.slice(0, 3)).toEqual(['id', 'name', 'price']);
		expect(aoa[1]?.[0]).toBe(1);
		expect(aoa[1]?.[2]).toBe(12.5);
		expect(aoa[2]?.[1]).toBe('NULL');
	});

	it('dedupes sheet names', async () => {
		const fc = fakeContext();
		const zip = await runPlugin(ods, fc, async (ctx) => {
			await ods.data!(ctx, dataOf('t', [field('a', 'int')], [['1']]));
			await ods.data!(ctx, dataOf('t', [field('a', 'int')], [['2']]));
		});
		const x = unzipText(zip)['content.xml'];
		expect(x).toContain('table:name="t"');
		expect(x).toContain('table:name="t_2"');
	});
});

describe('odt', () => {
	it('builds structure and data tables', async () => {
		const fc = fakeContext({ columns: true, null: 'N/A' }, quickStructure);
		const zip = await runPlugin(odt, fc, async (ctx) => {
			await odt.dbHeader!(ctx, 'd');
			await odt.structure!(ctx, { db: 'd', table: 'books', kind: 'table' }, 'structure_and_data');
			await odt.data!(ctx, dataOf('books', fields, rows()));
		});
		expect(listZip(zip)[0]).toEqual({ name: 'mimetype', method: 0 });
		const files = unzipText(zip);
		expect(files.mimetype).toBe('application/vnd.oasis.opendocument.text');
		const x = files['content.xml'];
		expect(x).toContain('>Database d</text:h>');
		expect(x).toContain('>Table structure for table books</text:h>');
		expect(x).toContain('table:name="books_structure"');
		expect(x).toContain('table:number-columns-repeated="6"');
		for (const h of ['Column', 'Type', 'Null', 'Default', 'Links to', 'Comments']) {
			expect(x).toContain(`<text:p>${h}</text:p>`);
		}
		expect(x).toContain('<text:p>int unsigned</text:p>');
		expect(x).toContain('<text:p>authors (id)</text:p>');
		expect(x).toContain('<text:p>pk &lt;1&gt;</text:p>');
		expect(x).toContain('<text:p>NULL</text:p>'); // default of nullable column
		expect(x).toContain('>Dumping data for table books</text:h>');
		expect(x).toContain('table:name="books_data"');
		expect(x).toContain('office:value-type="float" office:value="12.50"');
		expect(x).toContain('<text:p>N/A</text:p>');
	});

	it('honours relation/comments off and query results', async () => {
		const fc = fakeContext({ relation: false, comments: false, columns: false }, quickStructure);
		const zip = await runPlugin(odt, fc, async (ctx) => {
			await odt.structure!(ctx, { db: 'd', table: 'books', kind: 'view' }, 'structure');
			await odt.data!(ctx, dataOf('', [field('a', 'int')], [['1']]));
		});
		const x = unzipText(zip)['content.xml'];
		expect(x).toContain('>Structure for view books</text:h>');
		expect(x).not.toContain('Links to');
		expect(x).not.toContain('Comments');
		expect(x).toContain('>Dumping data for query result</text:h>');
		expect(x).not.toContain('<text:p>a</text:p>');
	});
});

describe('pdf', () => {
	it('renders title, headers, unicode text and page numbers', async () => {
		const fc = fakeContext({ report_title: 'Rapport Łódź' }, quickStructure);
		const bytes = await runPlugin(pdf, fc, async (ctx) => {
			await pdf.structure!(ctx, { db: 'd', table: 'books', kind: 'table' }, 'structure_and_data');
			await pdf.data!(
				ctx,
				dataOf(
					'books',
					[field('id', 'int'), field('name', 'varchar'), field('img', 'blob', { isBinary: true })],
					[
						['1', 'Zażółć gęślą jaźń — ŞĞ', Buffer.from([1])],
						['2', null, null]
					]
				)
			);
		});
		expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-');
		expect(pdfPageCount(bytes)).toBe(2);
		const text = pdfText(bytes).join('\n');
		expect(text).toContain('Rapport Łódź');
		expect(text).toContain('Database: d,  Table: books,  Purpose: Table structure');
		expect(text).toContain('Purpose: Dumping data');
		expect(text).toContain('Zażółć gęślą jaźń — ŞĞ');
		expect(text).toContain('authors (id)');
		expect(text).toContain('NULL');
		expect(text).toContain('Page 1/2');
		expect(text).toContain('Page 2/2');
		expect(text).not.toContain('img');
	});

	it('repeats the header row on every page of a long table', async () => {
		const many = Array.from({ length: 400 }, (_, i) => [String(i), 'row ' + i]);
		const fc = fakeContext({ report_title: 'Long' });
		const bytes = await runPlugin(pdf, fc, (ctx) =>
			pdf.data!(ctx, dataOf('big', [field('id', 'int'), field('label', 'varchar')], many))
		);
		const pages = pdfPageCount(bytes);
		expect(pages).toBeGreaterThan(2);
		const lines = pdfText(bytes);
		expect(lines.filter((l) => l === 'label').length).toBe(pages);
		expect(lines.filter((l) => l === 'Long').length).toBe(pages);
		expect(lines).toContain(`Page ${pages}/${pages}`);
	});

	it('produces a valid document with no data at all', async () => {
		const bytes = await runPlugin(pdf, fakeContext(), async () => {});
		expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-');
		expect(pdfPageCount(bytes)).toBe(1);
	});
});
