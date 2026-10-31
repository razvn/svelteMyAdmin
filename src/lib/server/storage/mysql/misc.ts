/** MySQL `pma__savedsearches`, `pma__table_uiprefs` and `pma__export_templates`. */
import type { ExportTemplatesRepo, SavedSearchesRepo, TableUiPrefsRepo } from '../types.ts';
import { pinger, type Run } from './runner.ts';

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export const savedSearchesRepo = (run: Run, q: string): SavedSearchesRepo => ({
	ping: pinger(run, q),
	list: (user, db) =>
		run(async (c) => {
			const [r] = await c.query(
				`SELECT id, search_name, search_data FROM ${q} WHERE username = ? AND db_name = ? ORDER BY search_name`,
				[user, db]
			);
			return (r as Row[]).map((x) => ({
				id: Number(x.id),
				name: str(x.search_name),
				data: str(x.search_data)
			}));
		}),
	insert: (user, db, name, json) =>
		run(async (c) => {
			const [r] = await c.query(
				`INSERT INTO ${q} (username, db_name, search_name, search_data) VALUES (?, ?, ?, ?)`,
				[user, db, name, json]
			);
			return Number((r as { insertId: number }).insertId);
		}),
	update: (id, user, db, name, json) =>
		run(async (c) => {
			const [r] = await c.query(
				`UPDATE ${q} SET search_name = ?, search_data = ? WHERE id = ? AND username = ? AND db_name = ?`,
				[name, json, id, user, db]
			);
			return (r as { affectedRows: number }).affectedRows;
		}),
	delete: (id, user, db) =>
		run(async (c) => {
			const [r] = await c.query(`DELETE FROM ${q} WHERE id = ? AND username = ? AND db_name = ?`, [
				id,
				user,
				db
			]);
			return (r as { affectedRows: number }).affectedRows;
		})
});

export const tableUiPrefsRepo = (run: Run, q: string): TableUiPrefsRepo => ({
	ping: pinger(run, q),
	get: (user, db, table) =>
		run(async (c) => {
			const [rows] = await c.query(
				`SELECT prefs FROM ${q} WHERE username = ? AND db_name = ? AND table_name = ?`,
				[user, db, table]
			);
			const row = (rows as { prefs: unknown }[])[0];
			return row ? str(row.prefs) : null;
		}),
	set: (user, db, table, json) =>
		run(async (c) => {
			await c.query(
				`INSERT INTO ${q} (username, db_name, table_name, prefs) VALUES (?, ?, ?, ?) ` +
					'ON DUPLICATE KEY UPDATE prefs = VALUES(prefs)',
				[user, db, table, json]
			);
		})
});

export const exportTemplatesRepo = (run: Run, q: string): ExportTemplatesRepo => ({
	ping: pinger(run, q),
	list: (user, type) =>
		run(async (c) => {
			const [r] = await c.query(
				`SELECT \`id\`, \`template_name\` FROM ${q} WHERE \`username\` = ? AND \`export_type\` = ? ORDER BY \`template_name\``,
				[user, type]
			);
			return (r as Row[]).map((x) => ({ id: Number(x.id), name: str(x.template_name) }));
		}),
	get: (id, user) =>
		run(async (c) => {
			const [r] = await c.query(
				`SELECT \`template_data\` FROM ${q} WHERE \`id\` = ? AND \`username\` = ?`,
				[id, user]
			);
			const row = (r as Row[])[0];
			return row ? str(row.template_data) : null;
		}),
	create: (user, type, name, json) =>
		run(async (c) => {
			const [r] = await c.query(
				`INSERT INTO ${q} (\`username\`, \`export_type\`, \`template_name\`, \`template_data\`) VALUES (?, ?, ?, ?)`,
				[user, type, name, json]
			);
			return Number((r as { insertId: number }).insertId);
		}),
	update: (id, user, json) =>
		run(async (c) => {
			const [r] = await c.query(
				`UPDATE ${q} SET \`template_data\` = ? WHERE \`id\` = ? AND \`username\` = ?`,
				[json, id, user]
			);
			return (r as { affectedRows: number }).affectedRows > 0;
		}),
	delete: (id, user) =>
		run(async (c) => {
			const [r] = await c.query(`DELETE FROM ${q} WHERE \`id\` = ? AND \`username\` = ?`, [
				id,
				user
			]);
			return (r as { affectedRows: number }).affectedRows > 0;
		})
});
