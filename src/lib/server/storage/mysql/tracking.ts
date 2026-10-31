/** MySQL `pma__tracking` (libraries/classes/Tracker.php storage side). */
import type { Connection } from 'mysql2/promise';
import { escapeId } from '#lib/server/db/escape.ts';
import type { TrackingRawRow, TrackingRepo, TrackingVersionRow } from '../types.ts';
import { pinger, type Run } from './runner.ts';

type Row = Record<string, unknown>;

async function rows(conn: Connection, sql: string, params: unknown[] = []): Promise<Row[]> {
	const [r] = await conn.query(sql, params);
	return r as Row[];
}

const toVersion = (r: Row): TrackingVersionRow => ({
	db: String(r.db_name),
	table: String(r.table_name),
	version: Number(r.version),
	created: String(r.date_created),
	updated: String(r.date_updated),
	tracking: String(r.tracking ?? ''),
	active: Number(r.tracking_active) === 1
});

const nullable = (v: unknown) => (v === null || v === undefined ? null : String(v));

export const trackingRepo = (run: Run, q: string): TrackingRepo => ({
	ping: pinger(run, q),
	anyActive: (db) =>
		run(
			async (c) =>
				(
					await rows(
						c,
						`SELECT 1 AS x FROM ${q} WHERE tracking_active = 1 AND db_name = ? LIMIT 1`,
						[db]
					)
				).length > 0
		),
	maxVersion: (db, table, statement) =>
		run(async (c) => {
			let sql = `SELECT MAX(version) AS v FROM ${q} WHERE db_name = ? AND table_name = ?`;
			const params = [db, table];
			if (statement) {
				sql += ' AND FIND_IN_SET(?, tracking) > 0';
				params.push(statement);
			}
			const v = (await rows(c, sql, params))[0]?.v;
			return v === null || v === undefined ? -1 : Number(v);
		}),
	isActive: (db, table) =>
		run(async (c) => {
			const r = await rows(
				c,
				`SELECT tracking_active FROM ${q} WHERE db_name = ? AND table_name = ? ORDER BY version DESC LIMIT 1`,
				[db, table]
			);
			return Number(r[0]?.tracking_active) === 1;
		}),
	insert: (v) =>
		run(async (c) => {
			await c.query(
				`INSERT INTO ${q} (db_name, table_name, version, date_created, date_updated, schema_snapshot, schema_sql, data_sql, tracking) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				[
					v.db,
					v.table,
					v.version,
					v.created,
					v.updated,
					v.snapshot,
					v.schemaSql,
					v.dataSql,
					v.tracking
				]
			);
		}),
	setActive: (db, table, version, active) =>
		run(async (c) => {
			await c.query(
				`UPDATE ${q} SET tracking_active = ? WHERE db_name = ? AND table_name = ? AND version = ?`,
				[active ? 1 : 0, db, table, version]
			);
		}),
	delete: (db, table, version) =>
		run(async (c) => {
			let sql = `DELETE FROM ${q} WHERE db_name = ? AND table_name = ?`;
			const params: (string | number)[] = [db, table];
			if (version) {
				sql += ' AND version = ?';
				params.push(version);
			}
			await c.query(sql, params);
		}),
	listVersions: (db, table) =>
		run(async (c) =>
			(
				await rows(
					c,
					`SELECT * FROM ${q} WHERE db_name = ? AND table_name = ? ORDER BY version DESC`,
					[db, table]
				)
			).map(toVersion)
		),
	listTracked: (db) =>
		run(async (c) =>
			(
				await rows(
					c,
					`SELECT t.* FROM ${q} t JOIN (SELECT table_name, MAX(version) AS v FROM ${q} WHERE db_name = ? AND table_name <> '' GROUP BY table_name) m ON t.table_name = m.table_name AND t.version = m.v WHERE t.db_name = ? ORDER BY t.table_name`,
					[db, db]
				)
			).map(toVersion)
		),
	get: (db, table, version) =>
		run(async (c): Promise<TrackingRawRow | null> => {
			const r = (
				await rows(
					c,
					`SELECT * FROM ${q} WHERE db_name = ? AND table_name = ? AND version = ? LIMIT 1`,
					[db, table, version]
				)
			)[0];
			if (!r) return null;
			return {
				tracking: String(r.tracking ?? ''),
				schema_snapshot: nullable(r.schema_snapshot),
				schema_sql: nullable(r.schema_sql),
				data_sql: nullable(r.data_sql)
			};
		}),
	saveLog: (db, table, version, which, text) =>
		run(async (c) => {
			const col = which === 'ddl' ? 'schema_sql' : 'data_sql';
			await c.query(
				`UPDATE ${q} SET ${escapeId(col)} = ? WHERE db_name = ? AND table_name = ? AND version = ?`,
				[text, db, table, version]
			);
		}),
	appendLog: (o) =>
		run(async (c) => {
			const col = o.which === 'ddl' ? 'schema_sql' : 'data_sql';
			let update = `UPDATE ${q} SET ${escapeId(col)} = CONCAT(COALESCE(${escapeId(col)}, ''), ?), date_updated = ?`;
			const params: (string | number)[] = [o.chunk, o.updated];
			if (o.renameTo) {
				update += ', table_name = ?';
				params.push(o.renameTo);
			}
			update +=
				' WHERE FIND_IN_SET(?, tracking) > 0 AND db_name = ? AND table_name = ? AND version = ?';
			params.push(o.statement, o.db, o.table, o.version);
			await c.query(update, params);
		})
});
