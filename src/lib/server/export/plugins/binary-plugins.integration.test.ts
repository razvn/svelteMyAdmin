import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { createConnection, type Connection } from '#lib/server/db/connection.ts';
import { escapeQualified } from '#lib/server/db/escape.ts';
import ods from '#lib/server/export/plugins/ods.ts';
import odt from '#lib/server/export/plugins/odt.ts';
import pdf from '#lib/server/export/plugins/pdf.ts';
import {
	fakeContext,
	listZip,
	pdfPageCount,
	pdfText,
	rowsOf,
	runPlugin,
	unzipText
} from '#lib/server/export/plugins/binary-testing.ts';
import type { ExportCell, ExportData, ExportField } from '#lib/server/export/types.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

async function load(conn: Connection, table: string): Promise<ExportData> {
	const qualified = escapeQualified('sma_test', table);
	const [cols] = await conn.query(`SHOW FULL COLUMNS FROM ${qualified}`);
	const fields: ExportField[] = (cols as Record<string, string>[]).map((c) => {
		const type = c.Type.replace(/\(.*$/, '').replace(/\s.*$/, '').toLowerCase();
		const blob = /blob|binary/.test(type);
		return {
			name: c.Field,
			type,
			columnType: c.Type,
			isBinary: blob,
			isNumeric: /int|decimal|float|double|year/.test(type),
			nullable: c.Null === 'YES'
		};
	});
	const [raw] = await conn.query({
		sql: `SELECT * FROM ${qualified} ORDER BY 1`,
		rowsAsArray: true,
		dateStrings: true
	});
	const rows: ExportCell[][] = (raw as unknown[][]).map((r) =>
		r.map((v) =>
			v === null || v === undefined
				? null
				: Buffer.isBuffer(v)
					? v
					: typeof v === 'object'
						? JSON.stringify(v)
						: String(v)
		)
	);
	return {
		ref: { db: 'sma_test', table, kind: 'table' },
		fields,
		rows: rowsOf(rows),
		sql: `SELECT * FROM ${qualified}`
	};
}

for (const { name, port } of servers) {
	describe(`binary export plugins against ${name}`, () => {
		let conn: Connection | undefined;

		beforeAll(async () => {
			try {
				conn = await createConnection(
					{
						host: '127.0.0.1',
						port,
						socket: '',
						ssl: false,
						ssl_ca: null,
						ssl_cert: null,
						ssl_key: null,
						ssl_ciphers: null,
						ssl_verify: true,
						compress: false
					},
					'root',
					'root'
				);
			} catch {
				console.warn(`[integration] ${name} unreachable on 127.0.0.1:${port}, skipping`);
			}
		});
		afterAll(async () => {
			await conn?.end();
		});

		it('ods: books + type_zoo', async ({ skip }) => {
			if (!conn) return skip();
			const c = conn;
			const fc = fakeContext({ columns: true }, c);
			const zip = await runPlugin(ods, fc, async (ctx) => {
				await ods.data!(ctx, await load(c, 'books'));
				await ods.data!(ctx, await load(c, 'type_zoo'));
			});
			expect(listZip(zip)[0]).toEqual({ name: 'mimetype', method: 0 });
			const wb = XLSX.read(zip, { type: 'array' });
			expect(wb.SheetNames).toEqual(['books', 'type_zoo']);
			const books = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.books, { header: 1 });
			expect(books[0]).toEqual([
				'id',
				'author_id',
				'title',
				'price',
				'published_at',
				'updated_at',
				'status'
			]);
			expect(books.length).toBeGreaterThan(1);
			expect(typeof books[1][0]).toBe('number');
			const x = unzipText(zip)['content.xml'];
			expect(x).toContain('office:value-type="float"');
			expect(x).toContain('varchar éè');
			expect(x).toContain('office:date-value="2024-02-29"');
			expect(x).toContain('office:date-value="2024-02-29T13:45:10"');
			expect(x).toContain('office:time-value="-PT12H34M56S"');
			// second type_zoo row is all NULL
			expect(x).toContain('<text:p>NULL</text:p>');
		});

		it('odt: structure and data with foreign key', async ({ skip }) => {
			if (!conn) return skip();
			const c = conn;
			const fc = fakeContext({}, c);
			const zip = await runPlugin(odt, fc, async (ctx) => {
				await odt.dbHeader!(ctx, 'sma_test');
				await odt.structure!(ctx, { db: 'sma_test', table: 'books', kind: 'table' }, 'structure');
				await odt.data!(ctx, await load(c, 'books'));
				await odt.structure!(
					ctx,
					{ db: 'sma_test', table: 'type_zoo', kind: 'table' },
					'structure'
				);
				await odt.data!(ctx, await load(c, 'type_zoo'));
			});
			const x = unzipText(zip)['content.xml'];
			expect(x).toContain('>Database sma_test</text:h>');
			expect(x).toContain('<text:p>authors (id)</text:p>');
			expect(x).toContain('enum(&#039;draft&#039;,&#039;published&#039;,&#039;archived&#039;)');
			expect(x).toContain('table:name="type_zoo_data"');
			expect(x).toContain('varchar éè');
		});

		it('pdf: books + type_zoo', async ({ skip }) => {
			if (!conn) return skip();
			const c = conn;
			const fc = fakeContext({ report_title: 'Integration' }, c);
			const bytes = await runPlugin(pdf, fc, async (ctx) => {
				await pdf.structure!(ctx, { db: 'sma_test', table: 'books', kind: 'table' }, 'structure');
				await pdf.data!(ctx, await load(c, 'books'));
				await pdf.data!(ctx, await load(c, 'type_zoo'));
			});
			expect(Buffer.from(bytes.subarray(0, 5)).toString()).toBe('%PDF-');
			expect(pdfPageCount(bytes)).toBe(3);
			const text = pdfText(bytes).join('\n');
			expect(text).toContain('Integration');
			expect(text).toContain('Purpose: Table structure');
			expect(text).toContain('éè');
			expect(text).toContain('Page 3/3');
		});
	});
}
