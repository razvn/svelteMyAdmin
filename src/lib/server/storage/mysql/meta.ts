/** MySQL `pma__relation`, `pma__table_info` and `pma__column_info`. */
import type { Connection } from 'mysql2/promise';
import { quoteValue } from '#lib/server/db/escape.ts';
import type { ColumnInfoRepo, RelationRepo, TableInfoRepo } from '../types.ts';
import { pinger, type Run } from './runner.ts';

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/** `$db_comment` marker phpMyAdmin stores in `pma__column_info.column_name` for a database comment. */
export const DB_COMMENT_COLUMN = '(db_comment)';

type Ref = { db: string; table: string };

export const relationRepo = (run: Run, tbl: string): RelationRepo => ({
	ping: pinger(run, tbl),
	listForTable: (db, table) =>
		run(async (c) => {
			const [r] = await c.query(
				'SELECT master_field, foreign_db, foreign_table, foreign_field FROM ' +
					`${tbl} WHERE master_db = ? AND master_table = ? ORDER BY master_field`,
				[db, table]
			);
			return (r as Row[]).map((x) => ({
				column: str(x.master_field),
				refDb: str(x.foreign_db),
				refTable: str(x.foreign_table),
				refColumn: str(x.foreign_field)
			}));
		}),
	listForDb: (db) =>
		run(async (c) => {
			const [r] = await c.query(
				'SELECT master_table, master_field, foreign_db, foreign_table, foreign_field FROM ' +
					`${tbl} WHERE master_db = ?`,
				[db]
			);
			return (r as Row[]).map((x) => ({
				masterTable: str(x.master_table),
				column: str(x.master_field),
				refDb: str(x.foreign_db),
				refTable: str(x.foreign_table),
				refColumn: str(x.foreign_field)
			}));
		}),
	set: (db, table, column, ref) =>
		run(async (c) => {
			const statements: { sql: string; params: unknown[] }[] = [
				{
					sql: `DELETE FROM ${tbl} WHERE master_db = ? AND master_table = ? AND master_field = ?`,
					params: [db, table, column]
				}
			];
			if (ref) {
				statements.push({
					sql:
						`INSERT INTO ${tbl} (master_db, master_table, master_field, foreign_db, foreign_table, ` +
						'foreign_field) VALUES (?, ?, ?, ?, ?, ?)',
					params: [db, table, column, ref.db, ref.table, ref.column]
				});
			}
			for (const s of statements) await c.query(s.sql, s.params);
			return statements.map((s) => s.sql);
		}),
	transferTable: (from: Ref, to: Ref, move: boolean) =>
		run(async (c) => {
			const qv = quoteValue;
			const f = { db: qv(from.db), table: qv(from.table) };
			const t = { db: qv(to.db), table: qv(to.table) };
			const statements = move
				? [
						`UPDATE ${tbl} SET \`foreign_db\` = ${t.db}, \`foreign_table\` = ${t.table} ` +
							`WHERE \`foreign_db\` = ${f.db} AND \`foreign_table\` = ${f.table}`,
						`UPDATE ${tbl} SET \`master_db\` = ${t.db}, \`master_table\` = ${t.table} ` +
							`WHERE \`master_db\` = ${f.db} AND \`master_table\` = ${f.table}`
					]
				: [
						`INSERT IGNORE INTO ${tbl} (\`master_db\`, \`master_table\`, \`master_field\`, \`foreign_db\`, ` +
							`\`foreign_table\`, \`foreign_field\`) SELECT ${t.db}, ${t.table}, \`master_field\`, ${t.db}, ` +
							`\`foreign_table\`, \`foreign_field\` FROM ${tbl} ` +
							`WHERE \`master_db\` = ${f.db} AND \`master_table\` = ${f.table}`,
						`INSERT IGNORE INTO ${tbl} (\`master_db\`, \`master_table\`, \`master_field\`, \`foreign_db\`, ` +
							`\`foreign_table\`, \`foreign_field\`) SELECT ${t.db}, \`master_table\`, \`master_field\`, ${t.db}, ` +
							`${t.table}, \`foreign_field\` FROM ${tbl} ` +
							`WHERE \`foreign_db\` = ${f.db} AND \`foreign_table\` = ${f.table}`
					];
			for (const s of statements) await c.query(s);
			return statements;
		})
});

export const tableInfoRepo = (run: Run, tbl: string): TableInfoRepo => ({
	ping: pinger(run, tbl),
	get: (db, table) =>
		run(async (c) => {
			const [r] = await c.query(
				`SELECT display_field FROM ${tbl} WHERE db_name = ? AND table_name = ?`,
				[db, table]
			);
			return str((r as Row[])[0]?.display_field);
		}),
	listForDb: (db) =>
		run(async (c) => {
			const [r] = await c.query(`SELECT table_name, display_field FROM ${tbl} WHERE db_name = ?`, [
				db
			]);
			return (r as Row[]).map((x) => ({
				table: str(x.table_name),
				displayField: str(x.display_field)
			}));
		}),
	set: (db, table, column) =>
		run(async (c) => {
			if (column === '') {
				await c.query(`DELETE FROM ${tbl} WHERE db_name = ? AND table_name = ?`, [db, table]);
			} else {
				await c.query(`REPLACE INTO ${tbl} (db_name, table_name, display_field) VALUES (?, ?, ?)`, [
					db,
					table,
					column
				]);
			}
		}),
	transferTable: (from: Ref, to: Ref, move: boolean) =>
		run(async (c) => {
			const qv = quoteValue;
			const f = { db: qv(from.db), table: qv(from.table) };
			const t = { db: qv(to.db), table: qv(to.table) };
			const sql = move
				? `UPDATE ${tbl} SET \`db_name\` = ${t.db}, \`table_name\` = ${t.table} ` +
					`WHERE \`db_name\` = ${f.db} AND \`table_name\` = ${f.table}`
				: `INSERT IGNORE INTO ${tbl} (\`db_name\`, \`table_name\`, \`display_field\`) ` +
					`SELECT ${t.db}, ${t.table}, \`display_field\` FROM ${tbl} ` +
					`WHERE \`db_name\` = ${f.db} AND \`table_name\` = ${f.table}`;
			await c.query(sql);
			return [sql];
		})
});

const MIME_COLS =
	'`mimetype`, `transformation`, `transformation_options`, `input_transformation`, `input_transformation_options`';

async function saveMimeEntries(
	conn: Connection,
	qualified: string,
	db: string,
	tableName: string,
	entries: Parameters<ColumnInfoRepo['saveMime']>[2]
): Promise<void> {
	for (const entry of entries) {
		const row = entry.row;
		if (entry.oldName && entry.oldName !== entry.column) {
			await conn.query(
				`UPDATE ${qualified} SET \`column_name\` = ? WHERE \`db_name\` = ? AND \`table_name\` = ? AND \`column_name\` = ?`,
				[entry.column, db, tableName, entry.oldName]
			);
		}
		const hasValue = Object.values(row).some((v) => v.length > 0);
		const [found] = await conn.query(
			`SELECT \`comment\` FROM ${qualified} WHERE \`db_name\` = ? AND \`table_name\` = ? AND \`column_name\` = ?`,
			[db, tableName, entry.column]
		);
		const existing = (found as Row[])[0];
		const key = [db, tableName, entry.column];
		const values = [
			row.mimetype,
			row.transformation,
			row.transformation_options,
			row.input_transformation,
			row.input_transformation_options
		];
		if (existing) {
			if (hasValue || str(existing.comment).length > 0) {
				await conn.query(
					`UPDATE ${qualified} SET \`mimetype\` = ?, \`transformation\` = ?, \`transformation_options\` = ?, ` +
						'`input_transformation` = ?, `input_transformation_options` = ? ' +
						'WHERE `db_name` = ? AND `table_name` = ? AND `column_name` = ?',
					[...values, ...key]
				);
			} else {
				await conn.query(
					`DELETE FROM ${qualified} WHERE \`db_name\` = ? AND \`table_name\` = ? AND \`column_name\` = ?`,
					key
				);
			}
		} else if (hasValue) {
			await conn.query(
				`INSERT INTO ${qualified} (\`db_name\`, \`table_name\`, \`column_name\`, ${MIME_COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
				[...key, ...values]
			);
		}
	}
}

export const columnInfoRepo = (run: Run, tbl: string): ColumnInfoRepo => ({
	ping: pinger(run, tbl),
	loadMime: (db, table) =>
		run(async (c) => {
			const [res] = await c.query(
				'SELECT `column_name`, `mimetype`, `transformation`, `transformation_options`, ' +
					'`input_transformation`, `input_transformation_options` FROM ' +
					tbl +
					" WHERE `db_name` = ? AND `table_name` = ? AND (`mimetype` != '' OR `transformation` != '' " +
					"OR `transformation_options` != '' OR `input_transformation` != '' " +
					"OR `input_transformation_options` != '')",
				[db, table]
			);
			return (res as Row[]).map((r) => ({
				column: str(r.column_name),
				mimetype: str(r.mimetype),
				transformation: str(r.transformation),
				transformation_options: str(r.transformation_options),
				input_transformation: str(r.input_transformation),
				input_transformation_options: str(r.input_transformation_options)
			}));
		}),
	saveMime: (db, table, entries) => run((c) => saveMimeEntries(c, tbl, db, table, entries)),
	getDbComment: (db) =>
		run(async (c) => {
			const [r] = await c.query(
				`SELECT \`comment\` FROM ${tbl} WHERE db_name = ? AND table_name = '' AND column_name = ?`,
				[db, DB_COMMENT_COLUMN]
			);
			return str((r as Row[])[0]?.comment);
		}),
	setDbComment: (db, comment) =>
		run(async (c) => {
			const sql =
				comment.length > 0
					? `INSERT INTO ${tbl} (\`db_name\`, \`table_name\`, \`column_name\`, \`comment\`) VALUES ` +
						`(${quoteValue(db)}, '', ${quoteValue(DB_COMMENT_COLUMN)}, ${quoteValue(comment)}) ` +
						`ON DUPLICATE KEY UPDATE \`comment\` = ${quoteValue(comment)}`
					: `DELETE FROM ${tbl} WHERE \`db_name\` = ${quoteValue(db)} AND \`table_name\` = '' ` +
						`AND \`column_name\` = ${quoteValue(DB_COMMENT_COLUMN)}`;
			await c.query(sql);
			return [sql];
		}),
	listForDb: (db) =>
		run(async (c) => {
			const [res] = await c.query(
				`SELECT table_name AS t, column_name AS c, \`comment\` AS cm, mimetype AS m FROM ${tbl} WHERE db_name = ? AND table_name <> ''`,
				[db]
			);
			return (res as Row[]).map((r) => ({
				table: str(r.t),
				column: str(r.c),
				comment: str(r.cm),
				mimetype: str(r.m)
			}));
		}),
	transferDb: (oldDb, newDb, move) =>
		run(async (c) => {
			const sql = move
				? `UPDATE ${tbl} SET \`db_name\` = ${quoteValue(newDb)} WHERE \`db_name\` = ${quoteValue(oldDb)}`
				: `INSERT INTO ${tbl} (\`db_name\`, \`table_name\`, \`column_name\`, \`comment\`, \`mimetype\`, ` +
					'`transformation`, `transformation_options`, `input_transformation`, `input_transformation_options`) ' +
					`SELECT ${quoteValue(newDb)}, \`table_name\`, \`column_name\`, \`comment\`, \`mimetype\`, ` +
					'`transformation`, `transformation_options`, `input_transformation`, `input_transformation_options` ' +
					`FROM ${tbl} WHERE \`db_name\` = ${quoteValue(oldDb)}`;
			await c.query(sql);
			return [sql];
		}),
	transferTable: (from: Ref, to: Ref, move: boolean) =>
		run(async (c) => {
			const qv = quoteValue;
			const f = { db: qv(from.db), table: qv(from.table) };
			const t = { db: qv(to.db), table: qv(to.table) };
			const sql = move
				? `UPDATE ${tbl} SET \`db_name\` = ${t.db}, \`table_name\` = ${t.table} ` +
					`WHERE \`db_name\` = ${f.db} AND \`table_name\` = ${f.table}`
				: `INSERT IGNORE INTO ${tbl} (\`db_name\`, \`table_name\`, \`column_name\`, \`comment\`, ` +
					'`mimetype`, `transformation`, `transformation_options`, `input_transformation`, ' +
					`\`input_transformation_options\`) SELECT ${t.db}, ${t.table}, \`column_name\`, \`comment\`, ` +
					'`mimetype`, `transformation`, `transformation_options`, `input_transformation`, ' +
					`\`input_transformation_options\` FROM ${tbl} WHERE \`db_name\` = ${f.db} AND \`table_name\` = ${f.table}`;
			await c.query(sql);
			return [sql];
		})
});
