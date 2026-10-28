import { XMLValidator } from 'fast-xml-parser';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '#lib/server/db/connection.ts';
import { escapeQualified } from '#lib/server/db/escape.ts';
import type { ExportCell, ExportContext, ExportData, ExportField } from '../types.ts';
import csv from './csv.ts';
import json from './json.ts';
import xml from './xml.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

interface Collected {
	ctx: ExportContext;
	text(): string;
}

function collectingContext(conn: Connection, options: Record<string, string | boolean>): Collected {
	const chunks: Buffer[] = [];
	const ctx: ExportContext = {
		write: async (chunk) => {
			chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk));
		},
		conn,
		scope: 'table',
		options,
		crlf: '\n',
		server: { version: 'integration', isMariaDb: false, host: '127.0.0.1' },
		appVersion: '0.0.1',
		now: new Date()
	};
	return { ctx, text: () => Buffer.concat(chunks).toString('utf8') };
}

/** Real export data for a table: column types from information_schema, rows through mysql2. */
async function booksExportData(conn: Connection): Promise<ExportData> {
	const [typeRows] = await conn.query(
		'SELECT COLUMN_NAME AS name, DATA_TYPE AS type FROM information_schema.COLUMNS ' +
			'WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
		['sma_test', 'books']
	);
	const fields: ExportField[] = (typeRows as { name: string; type: string }[]).map((row) => ({
		name: row.name,
		type: row.type.toLowerCase(),
		isBinary: false,
		isNumeric: false,
		nullable: true
	}));
	const sql = `SELECT * FROM ${escapeQualified('sma_test', 'books')} ORDER BY id`;
	const [rows] = await conn.query({ sql, rowsAsArray: true });
	// mysql2 returns INT columns as JS numbers; the ExportCell contract is text (string | Buffer | null).
	const data = (rows as unknown[][]).map((row) =>
		row.map((value): ExportCell =>
			typeof value === 'number' ? String(value) : (value as ExportCell)
		)
	);
	return {
		ref: { db: 'sma_test', table: 'books', kind: 'table' },
		fields,
		sql,
		rows: (async function* () {
			yield* data;
		})()
	};
}

for (const { name, port } of servers) {
	describe(`text exports of sma_test.books against ${name}`, () => {
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
				console.warn(
					`[integration] ${name} unreachable on 127.0.0.1:${port}, skipping (run pnpm db:up)`
				);
			}
		});

		afterAll(async () => {
			await conn?.end();
		});

		it('exports the CSV data with a header row and the real values', async (ctx) => {
			if (!conn) return ctx.skip();
			const out = collectingContext(conn, {});
			await csv.data?.(out.ctx, await booksExportData(conn));
			const lines = out.text().split('\n');
			expect(lines[0]).toBe(
				'"id","author_id","title","price","published_at","updated_at","status"'
			);
			expect(lines[1]).toMatch(
				/^"1","1","The Left Hand of Darkness","9\.99","1969-03-01 00:00:00",/
			);
			expect(lines.find((line) => line.startsWith('"4"'))).toMatch(
				/^"4","2","Unpublished Draft","0\.00",NULL,/
			);
			expect(lines.length).toBeGreaterThanOrEqual(5);
		});

		it('exports the JSON data as valid JSON with the table element', async (ctx) => {
			if (!conn) return ctx.skip();
			const out = collectingContext(conn, {});
			await json.header?.(out.ctx);
			await json.dbHeader?.(out.ctx, 'sma_test', '');
			await json.data?.(out.ctx, await booksExportData(conn));
			await json.footer?.(out.ctx);
			const parsed = JSON.parse(out.text()) as { type: string; data?: Record<string, unknown>[] }[];
			expect(parsed.map((element) => element.type)).toEqual(['header', 'database', 'table']);
			const rows = parsed[2]?.data ?? [];
			expect(rows[0]).toMatchObject({ id: '1', title: 'The Left Hand of Darkness', price: '9.99' });
			expect(rows.find((row) => row.id === '4')).toMatchObject({
				published_at: null,
				status: 'draft'
			});
		});

		it('exports the XML structure and data as well-formed XML', async (ctx) => {
			if (!conn) return ctx.skip();
			const out = collectingContext(conn, {});
			const data = await booksExportData(conn);
			await xml.header?.(out.ctx);
			await xml.dbHeader?.(out.ctx, 'sma_test', '');
			await xml.structure?.(out.ctx, data.ref, 'structure_and_data');
			await xml.data?.(out.ctx, data);
			await xml.dbFooter?.(out.ctx, 'sma_test');
			await xml.footer?.(out.ctx);
			const text = out.text();
			expect(XMLValidator.validate(text)).toBe(true);
			expect(text).toContain('<pma:table name="books">');
			expect(text).toContain('CREATE TABLE `books`');
			expect(text).toContain('<column name="title">The Left Hand of Darkness</column>');
			expect(text).toContain('<column name="published_at">NULL</column>');
		});
	});
}
