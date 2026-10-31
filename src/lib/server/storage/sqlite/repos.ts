/**
 * SQLite implementation of the storage repositories. Every statement is scoped with the `server`
 * column; MySQL-only SQL (`ON DUPLICATE KEY UPDATE`, `REPLACE INTO`, `INSERT IGNORE`, `FIND_IN_SET`)
 * is expressed with `ON CONFLICT`, `INSERT OR IGNORE` and `instr`. Methods are synchronous inside
 * and return promises only to satisfy the shared interfaces.
 */
import { parseConfigData, type PrefData } from '#lib/preferences/logic.ts';
import { parseTables, serializeTables } from '#lib/nav/recent.ts';
import { fromRow, toRowValues, type CentralRow } from '#lib/sql/central-columns.ts';
import type { HiddenType } from '#lib/nav/hidden.ts';
import type { Positions } from '#lib/designer/types.ts';
import type {
	AddResult,
	Bookmark,
	BookmarkRepo,
	CentralColumnsRepo,
	ColumnInfoRepo,
	DesignerPagesRepo,
	DesignerSettingsRepo,
	ExportTemplatesRepo,
	HistoryRepo,
	NavigationHidingRepo,
	RecentFavoriteRepo,
	RelationRepo,
	Repos,
	SavedSearchesRepo,
	TableInfoRepo,
	TableUiPrefsRepo,
	TrackingRepo,
	TrackingVersionRow,
	UserConfigRepo,
	UserGroup,
	UserGroupsRepo
} from '../types.ts';
import { SqliteStore } from './db.ts';

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const ping = () => Promise.resolve(true);

/** Statement text for display ("the SQL that was run"): `?` replaced by quoted values. */
function render(sql: string, params: (string | number)[]): string {
	let i = 0;
	return sql.replace(/\?/g, () => {
		const v = params[i++];
		return typeof v === 'number' ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
	});
}

const toBookmark = (r: Row): Bookmark => ({
	id: Number(r.id),
	db: str(r.dbase),
	label: str(r.label),
	query: str(r.query),
	shared: str(r.user) === ''
});

function bookmarks(st: SqliteStore): BookmarkRepo {
	const list = (user: string, db: string) =>
		st
			.all(
				`SELECT * FROM pma__bookmark WHERE server = ? AND ("user" = '' OR "user" = ?) AND dbase = ? ORDER BY label ASC`,
				st.server,
				user,
				db
			)
			.map(toBookmark);
	return {
		ping,
		list: async (user, db) => list(user, db),
		get: async (user, db, id) => {
			const row = st.get(
				`SELECT * FROM pma__bookmark WHERE server = ? AND id = ? AND dbase = ? AND ("user" = ? OR "user" = '') LIMIT 1`,
				st.server,
				id,
				db,
				user
			);
			return row ? toBookmark(row) : null;
		},
		insert: async (user, b) =>
			st.transaction(() => {
				if (b.replace) {
					// Own and shared bookmarks of the same label are replaced, like in phpMyAdmin.
					for (const x of list(user, b.db).filter((x) => x.label === b.label)) {
						st.run('DELETE FROM pma__bookmark WHERE server = ? AND id = ?', st.server, x.id);
					}
				}
				return st.run(
					`INSERT INTO pma__bookmark (server, dbase, "user", "query", label) VALUES (?, ?, ?, ?, ?)`,
					st.server,
					b.db,
					b.shared ? '' : user,
					b.query,
					b.label
				).insertId;
			}),
		delete: async (user, id) =>
			st.run(
				`DELETE FROM pma__bookmark WHERE server = ? AND id = ? AND ("user" = ? OR "user" = '')`,
				st.server,
				id,
				user
			).changes > 0
	};
}

function history(st: SqliteStore): HistoryRepo {
	return {
		ping,
		insert: async (row) => {
			st.run(
				`INSERT INTO pma__history (server, username, db, "table", sqlquery) VALUES (?, ?, ?, ?, ?)`,
				st.server,
				row.username,
				row.db.slice(0, 64),
				row.table.slice(0, 64),
				row.sqlquery
			);
		},
		purge: async (username, max) => {
			const limit = Math.max(1, Math.floor(max));
			const found = st.get<{ id: number }>(
				'SELECT id FROM pma__history WHERE server = ? AND username = ? ORDER BY id DESC LIMIT 1 OFFSET ?',
				st.server,
				username,
				limit
			);
			if (!found) return 0;
			return st.run(
				'DELETE FROM pma__history WHERE server = ? AND username = ? AND id <= ?',
				st.server,
				username,
				found.id
			).changes;
		},
		select: async (username, limit) =>
			st
				.all(
					`SELECT db, "table", sqlquery, timevalue FROM pma__history WHERE server = ? AND username = ? ORDER BY id DESC LIMIT ?`,
					st.server,
					username,
					Math.max(1, Math.floor(limit))
				)
				.map((r) => ({
					db: str(r.db),
					table: str(r.table),
					sqlquery: str(r.sqlquery),
					timevalue: str(r.timevalue)
				})),
		clear: async (username) => {
			st.run('DELETE FROM pma__history WHERE server = ? AND username = ?', st.server, username);
		}
	};
}

function recentFavorite(
	st: SqliteStore,
	table: 'pma__recent' | 'pma__favorite'
): RecentFavoriteRepo {
	return {
		ping,
		select: async (user) => {
			const row = st.get(
				`SELECT "tables" FROM ${table} WHERE server = ? AND username = ?`,
				st.server,
				user
			);
			return parseTables(row?.tables);
		},
		replace: async (user, list) => {
			st.run(
				`INSERT INTO ${table} (server, username, "tables") VALUES (?, ?, ?) ` +
					`ON CONFLICT (server, username) DO UPDATE SET "tables" = excluded."tables"`,
				st.server,
				user,
				serializeTables(list)
			);
		}
	};
}

function userConfig(st: SqliteStore): UserConfigRepo {
	return {
		ping,
		load: async (username) => {
			const row = st.get(
				`SELECT config_data, CAST(strftime('%s', timevalue) AS INTEGER) AS ts FROM pma__userconfig WHERE server = ? AND username = ?`,
				st.server,
				username
			);
			if (!row) return null;
			return { data: parseConfigData(str(row.config_data)), mtime: Number(row.ts) || 0 };
		},
		save: async (username, data: PrefData) => {
			// PHP json_encode()s an empty array as `[]`
			const json = Object.keys(data).length === 0 ? '[]' : JSON.stringify(data);
			st.run(
				`INSERT INTO pma__userconfig (server, username, config_data) VALUES (?, ?, ?) ` +
					`ON CONFLICT (server, username) DO UPDATE SET config_data = excluded.config_data, ` +
					`timevalue = strftime('%Y-%m-%d %H:%M:%S', 'now')`,
				st.server,
				username,
				json
			);
		},
		delete: async (username) => {
			st.run('DELETE FROM pma__userconfig WHERE server = ? AND username = ?', st.server, username);
		}
	};
}

function navigationHiding(st: SqliteStore): NavigationHidingRepo {
	return {
		ping,
		list: async (user, db) =>
			st
				.all(
					'SELECT item_name, item_type FROM pma__navigationhiding WHERE server = ? AND username = ? AND db_name = ? ORDER BY item_type, item_name',
					st.server,
					user,
					db
				)
				.map((r) => ({ name: str(r.item_name), type: str(r.item_type) as HiddenType })),
		hide: async (user, db, item) => {
			st.run(
				`INSERT OR IGNORE INTO pma__navigationhiding (server, username, item_name, item_type, db_name, table_name) VALUES (?, ?, ?, ?, ?, '')`,
				st.server,
				user,
				item.name,
				item.type,
				db
			);
		},
		unhide: async (user, db, item) => {
			st.run(
				'DELETE FROM pma__navigationhiding WHERE server = ? AND username = ? AND item_name = ? AND item_type = ? AND db_name = ?',
				st.server,
				user,
				item.name,
				item.type,
				db
			);
		}
	};
}

function userGroups(st: SqliteStore): UserGroupsRepo {
	const listGroups = (): UserGroup[] => {
		const rows = st.all(
			'SELECT usergroup, tab, allowed FROM pma__usergroups WHERE server = ? ORDER BY usergroup',
			st.server
		);
		const out = new Map<string, UserGroup>();
		for (const r of rows) {
			const name = str(r.usergroup);
			let g = out.get(name);
			if (!g) out.set(name, (g = { name, tabs: {} }));
			g.tabs[str(r.tab)] = str(r.allowed) === 'Y';
		}
		return [...out.values()];
	};
	return {
		ping,
		listGroups: async () => listGroups(),
		getGroup: async (name) => listGroups().find((g) => g.name === name) ?? null,
		saveGroup: async (name, allowedKeys, allTabKeys) => {
			const allowed = new Set(allowedKeys);
			st.transaction(() => {
				st.run('DELETE FROM pma__usergroups WHERE server = ? AND usergroup = ?', st.server, name);
				for (const k of allTabKeys) {
					st.run(
						'INSERT INTO pma__usergroups (server, usergroup, tab, allowed) VALUES (?, ?, ?, ?)',
						st.server,
						name,
						k,
						allowed.has(k) ? 'Y' : 'N'
					);
				}
			});
		},
		groupExists: async (name) =>
			!!st.get(
				'SELECT 1 AS x FROM pma__usergroups WHERE server = ? AND usergroup = ? LIMIT 1',
				st.server,
				name
			),
		deleteGroup: async (name) => {
			st.transaction(() => {
				st.run('DELETE FROM pma__users WHERE server = ? AND usergroup = ?', st.server, name);
				st.run('DELETE FROM pma__usergroups WHERE server = ? AND usergroup = ?', st.server, name);
			});
		},
		listGroupUsers: async (name) =>
			st
				.all(
					'SELECT username FROM pma__users WHERE server = ? AND usergroup = ? ORDER BY username',
					st.server,
					name
				)
				.map((r) => str(r.username)),
		listMemberships: async () =>
			Object.fromEntries(
				st
					.all('SELECT username, usergroup FROM pma__users WHERE server = ?', st.server)
					.map((r) => [str(r.username), str(r.usergroup)])
			),
		setUserGroup: async (username, group) => {
			st.transaction(() => {
				st.run('DELETE FROM pma__users WHERE server = ? AND username = ?', st.server, username);
				if (group) {
					st.run(
						'INSERT INTO pma__users (server, username, usergroup) VALUES (?, ?, ?)',
						st.server,
						username,
						group
					);
				}
			});
		},
		deniedTabKeys: async (username) =>
			st
				.all(
					`SELECT tab FROM pma__usergroups WHERE server = ? AND allowed = 'N' AND usergroup IN ` +
						`(SELECT usergroup FROM pma__users WHERE server = ? AND username = ?)`,
					st.server,
					st.server,
					username
				)
				.map((r) => str(r.tab))
	};
}

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

function centralColumns(st: SqliteStore): CentralColumnsRepo {
	const have = (db: string, names: string[]): Set<string> => {
		if (names.length === 0) return new Set();
		return new Set(
			st
				.all(
					`SELECT col_name FROM pma__central_columns WHERE server = ? AND db_name = ? AND col_name IN (${placeholders(names.length)})`,
					st.server,
					db,
					...names
				)
				.map((r) => str(r.col_name))
		);
	};
	return {
		ping,
		list: async (db, o = {}) => {
			const params: (string | number)[] = [st.server, db];
			let where = 'server = ? AND db_name = ?';
			if (o.filter) {
				where += ' AND instr(col_name, ?) > 0';
				params.push(o.filter);
			}
			let limit = '';
			if (o.num) {
				limit = ' LIMIT ? OFFSET ?';
				params.push(Math.trunc(o.num), Math.max(0, Math.trunc(o.pos ?? 0)));
			}
			const rows = st.all(
				`SELECT col_name, col_type, col_length, col_collation, "col_isNull" AS col_isNull, col_extra, col_default ` +
					`FROM pma__central_columns WHERE ${where} ORDER BY col_name${limit}`,
				...params
			);
			return (rows as unknown as CentralRow[]).map(fromRow);
		},
		count: async (db, filter = '') => {
			const params: (string | number)[] = [st.server, db];
			let where = 'server = ? AND db_name = ?';
			if (filter) {
				where += ' AND instr(col_name, ?) > 0';
				params.push(filter);
			}
			const row = st.get(
				`SELECT COUNT(*) AS n FROM pma__central_columns WHERE ${where}`,
				...params
			);
			return Number(row?.n ?? 0);
		},
		add: async (db, columns) =>
			st.transaction(() => {
				const exist = have(
					db,
					columns.map((c) => c.name)
				);
				const result: AddResult = { added: [], existing: [] };
				for (const c of columns) {
					if (exist.has(c.name)) {
						if (!result.existing.includes(c.name)) result.existing.push(c.name);
						continue;
					}
					exist.add(c.name);
					st.run(
						`INSERT INTO pma__central_columns (server, db_name, col_name, col_type, col_length, col_collation, "col_isNull", col_extra, col_default) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
						st.server,
						db,
						...(toRowValues(c) as (string | number)[])
					);
					result.added.push(c.name);
				}
				return result;
			}),
		update: async (db, original, c) => {
			const [name, ...rest] = toRowValues(c) as (string | number)[];
			st.run(
				`UPDATE pma__central_columns SET col_name = ?, col_type = ?, col_length = ?, col_collation = ?, "col_isNull" = ?, col_extra = ?, col_default = ? WHERE server = ? AND db_name = ? AND col_name = ?`,
				name,
				...rest,
				st.server,
				db,
				original
			);
		},
		delete: async (db, names) => {
			if (names.length === 0) return [];
			return st.transaction(() => {
				const exist = have(db, names);
				st.run(
					`DELETE FROM pma__central_columns WHERE server = ? AND db_name = ? AND col_name IN (${placeholders(names.length)})`,
					st.server,
					db,
					...names
				);
				return names.filter((n) => !exist.has(n));
			});
		}
	};
}

const toVersion = (r: Row): TrackingVersionRow => ({
	db: str(r.db_name),
	table: str(r.table_name),
	version: Number(r.version),
	created: str(r.date_created),
	updated: str(r.date_updated),
	tracking: str(r.tracking),
	active: Number(r.tracking_active) === 1
});

/** SQL: the SET column `tracking` contains `statement` (FIND_IN_SET). */
const HAS_STATEMENT = `instr(',' || COALESCE(tracking, '') || ',', ',' || ? || ',') > 0`;

function tracking(st: SqliteStore): TrackingRepo {
	return {
		ping,
		anyActive: async (db) =>
			!!st.get(
				'SELECT 1 AS x FROM pma__tracking WHERE server = ? AND tracking_active = 1 AND db_name = ? LIMIT 1',
				st.server,
				db
			),
		maxVersion: async (db, table, statement) => {
			const params: string[] = [st.server, db, table];
			let sql =
				'SELECT MAX(version) AS v FROM pma__tracking WHERE server = ? AND db_name = ? AND table_name = ?';
			if (statement) {
				sql += ` AND ${HAS_STATEMENT}`;
				params.push(statement);
			}
			const v = st.get(sql, ...params)?.v;
			return v === null || v === undefined ? -1 : Number(v);
		},
		isActive: async (db, table) =>
			Number(
				st.get(
					'SELECT tracking_active FROM pma__tracking WHERE server = ? AND db_name = ? AND table_name = ? ORDER BY version DESC LIMIT 1',
					st.server,
					db,
					table
				)?.tracking_active
			) === 1,
		insert: async (v) => {
			st.run(
				`INSERT INTO pma__tracking (server, db_name, table_name, version, date_created, date_updated, schema_snapshot, schema_sql, data_sql, tracking) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				st.server,
				v.db,
				v.table,
				v.version,
				v.created,
				v.updated,
				v.snapshot,
				v.schemaSql,
				v.dataSql,
				v.tracking
			);
		},
		setActive: async (db, table, version, active) => {
			st.run(
				'UPDATE pma__tracking SET tracking_active = ? WHERE server = ? AND db_name = ? AND table_name = ? AND version = ?',
				active ? 1 : 0,
				st.server,
				db,
				table,
				version
			);
		},
		delete: async (db, table, version) => {
			let sql = 'DELETE FROM pma__tracking WHERE server = ? AND db_name = ? AND table_name = ?';
			const params: (string | number)[] = [st.server, db, table];
			if (version) {
				sql += ' AND version = ?';
				params.push(version);
			}
			st.run(sql, ...params);
		},
		listVersions: async (db, table) =>
			st
				.all(
					'SELECT * FROM pma__tracking WHERE server = ? AND db_name = ? AND table_name = ? ORDER BY version DESC',
					st.server,
					db,
					table
				)
				.map(toVersion),
		listTracked: async (db) =>
			st
				.all(
					`SELECT t.* FROM pma__tracking t JOIN (SELECT table_name, MAX(version) AS v FROM pma__tracking WHERE server = ? AND db_name = ? AND table_name <> '' GROUP BY table_name) m ON t.table_name = m.table_name AND t.version = m.v WHERE t.server = ? AND t.db_name = ? ORDER BY t.table_name`,
					st.server,
					db,
					st.server,
					db
				)
				.map(toVersion),
		get: async (db, table, version) => {
			const r = st.get(
				'SELECT * FROM pma__tracking WHERE server = ? AND db_name = ? AND table_name = ? AND version = ? LIMIT 1',
				st.server,
				db,
				table,
				version
			);
			if (!r) return null;
			const nullable = (v: unknown) => (v === null || v === undefined ? null : String(v));
			return {
				tracking: str(r.tracking),
				schema_snapshot: nullable(r.schema_snapshot),
				schema_sql: nullable(r.schema_sql),
				data_sql: nullable(r.data_sql)
			};
		},
		saveLog: async (db, table, version, which, text) => {
			const col = which === 'ddl' ? 'schema_sql' : 'data_sql';
			st.run(
				`UPDATE pma__tracking SET ${col} = ? WHERE server = ? AND db_name = ? AND table_name = ? AND version = ?`,
				text,
				st.server,
				db,
				table,
				version
			);
		},
		appendLog: async (o) => {
			const col = o.which === 'ddl' ? 'schema_sql' : 'data_sql';
			let sql = `UPDATE pma__tracking SET ${col} = COALESCE(${col}, '') || ?, date_updated = ?`;
			const params: (string | number)[] = [o.chunk, o.updated];
			if (o.renameTo) {
				sql += ', table_name = ?';
				params.push(o.renameTo);
			}
			sql += ` WHERE server = ? AND ${HAS_STATEMENT} AND db_name = ? AND table_name = ? AND version = ?`;
			params.push(st.server, o.statement, o.db, o.table, o.version);
			st.run(sql, ...params);
		}
	};
}

function designerPages(st: SqliteStore): DesignerPagesRepo {
	return {
		ping,
		listPages: async (db) =>
			st
				.all(
					'SELECT page_nr, page_descr FROM pma__pdf_pages WHERE server = ? AND db_name = ? ORDER BY page_descr, page_nr',
					st.server,
					db
				)
				.map((r) => ({ id: Number(r.page_nr), name: str(r.page_descr) })),
		pageExists: async (db, id) =>
			!!st.get(
				'SELECT 1 AS x FROM pma__pdf_pages WHERE server = ? AND db_name = ? AND page_nr = ?',
				st.server,
				db,
				id
			),
		createPage: async (db, name) =>
			st.run(
				'INSERT INTO pma__pdf_pages (server, db_name, page_descr) VALUES (?, ?, ?)',
				st.server,
				db,
				name
			).insertId,
		renamePage: async (db, id, name) => {
			st.run(
				'UPDATE pma__pdf_pages SET page_descr = ? WHERE server = ? AND db_name = ? AND page_nr = ?',
				name,
				st.server,
				db,
				id
			);
		},
		deletePage: async (db, id) => {
			st.transaction(() => {
				st.run(
					'DELETE FROM pma__table_coords WHERE server = ? AND db_name = ? AND pdf_page_number = ?',
					st.server,
					db,
					id
				);
				st.run(
					'DELETE FROM pma__pdf_pages WHERE server = ? AND db_name = ? AND page_nr = ?',
					st.server,
					db,
					id
				);
			});
		},
		loadPositions: async (db, id) => {
			const out: Positions = {};
			for (const r of st.all(
				'SELECT table_name, x, y FROM pma__table_coords WHERE server = ? AND db_name = ? AND pdf_page_number = ?',
				st.server,
				db,
				id
			)) {
				out[str(r.table_name)] = { x: Number(r.x), y: Number(r.y) };
			}
			return out;
		},
		savePositions: async (db, id, positions) => {
			st.transaction(() => {
				st.run(
					'DELETE FROM pma__table_coords WHERE server = ? AND db_name = ? AND pdf_page_number = ?',
					st.server,
					db,
					id
				);
				for (const [table, p] of Object.entries(positions)) {
					// the MySQL columns are `float unsigned`: never negative
					st.run(
						'INSERT INTO pma__table_coords (server, db_name, table_name, pdf_page_number, x, y) VALUES (?, ?, ?, ?, ?, ?)',
						st.server,
						db,
						table,
						id,
						Math.max(0, p.x),
						Math.max(0, p.y)
					);
				}
			});
		}
	};
}

function designerSettings(st: SqliteStore): DesignerSettingsRepo {
	return {
		ping,
		get: async (username) => {
			const row = st.get(
				'SELECT settings_data FROM pma__designer_settings WHERE server = ? AND username = ?',
				st.server,
				username
			);
			return row ? str(row.settings_data) : null;
		},
		set: async (username, json) => {
			st.run(
				'INSERT INTO pma__designer_settings (server, username, settings_data) VALUES (?, ?, ?) ' +
					'ON CONFLICT (server, username) DO UPDATE SET settings_data = excluded.settings_data',
				st.server,
				username,
				json
			);
		}
	};
}

function relation(st: SqliteStore): RelationRepo {
	return {
		ping,
		listForTable: async (db, table) =>
			st
				.all(
					'SELECT master_field, foreign_db, foreign_table, foreign_field FROM pma__relation WHERE server = ? AND master_db = ? AND master_table = ? ORDER BY master_field',
					st.server,
					db,
					table
				)
				.map((r) => ({
					column: str(r.master_field),
					refDb: str(r.foreign_db),
					refTable: str(r.foreign_table),
					refColumn: str(r.foreign_field)
				})),
		listForDb: async (db) =>
			st
				.all(
					'SELECT master_table, master_field, foreign_db, foreign_table, foreign_field FROM pma__relation WHERE server = ? AND master_db = ?',
					st.server,
					db
				)
				.map((r) => ({
					masterTable: str(r.master_table),
					column: str(r.master_field),
					refDb: str(r.foreign_db),
					refTable: str(r.foreign_table),
					refColumn: str(r.foreign_field)
				})),
		set: async (db, table, column, ref) => {
			const del = {
				sql: 'DELETE FROM pma__relation WHERE server = ? AND master_db = ? AND master_table = ? AND master_field = ?',
				params: [st.server, db, table, column] as (string | number)[]
			};
			const statements = [del];
			if (ref) {
				statements.push({
					sql: 'INSERT INTO pma__relation (server, master_db, master_table, master_field, foreign_db, foreign_table, foreign_field) VALUES (?, ?, ?, ?, ?, ?, ?)',
					params: [st.server, db, table, column, ref.db, ref.table, ref.column]
				});
			}
			st.transaction(() => {
				for (const s of statements) st.run(s.sql, ...s.params);
			});
			return statements.map((s) => render(s.sql, s.params));
		},
		transferTable: async (from, to, move) => {
			const statements: { sql: string; params: string[] }[] = [];
			if (move) {
				statements.push(
					{
						sql: 'UPDATE pma__relation SET foreign_db = ?, foreign_table = ? WHERE server = ? AND foreign_db = ? AND foreign_table = ?',
						params: [to.db, to.table, st.server, from.db, from.table]
					},
					{
						sql: 'UPDATE pma__relation SET master_db = ?, master_table = ? WHERE server = ? AND master_db = ? AND master_table = ?',
						params: [to.db, to.table, st.server, from.db, from.table]
					}
				);
			} else {
				statements.push(
					{
						sql: 'INSERT OR IGNORE INTO pma__relation (server, master_db, master_table, master_field, foreign_db, foreign_table, foreign_field) SELECT server, ?, ?, master_field, ?, foreign_table, foreign_field FROM pma__relation WHERE server = ? AND master_db = ? AND master_table = ?',
						params: [to.db, to.table, to.db, st.server, from.db, from.table]
					},
					{
						sql: 'INSERT OR IGNORE INTO pma__relation (server, master_db, master_table, master_field, foreign_db, foreign_table, foreign_field) SELECT server, ?, master_table, master_field, ?, ?, foreign_field FROM pma__relation WHERE server = ? AND foreign_db = ? AND foreign_table = ?',
						params: [to.db, to.db, to.table, st.server, from.db, from.table]
					}
				);
			}
			st.transaction(() => {
				for (const s of statements) st.run(s.sql, ...s.params);
			});
			return statements.map((s) => render(s.sql, s.params));
		}
	};
}

function tableInfo(st: SqliteStore): TableInfoRepo {
	return {
		ping,
		get: async (db, table) =>
			str(
				st.get(
					'SELECT display_field FROM pma__table_info WHERE server = ? AND db_name = ? AND table_name = ?',
					st.server,
					db,
					table
				)?.display_field
			),
		listForDb: async (db) =>
			st
				.all(
					'SELECT table_name, display_field FROM pma__table_info WHERE server = ? AND db_name = ?',
					st.server,
					db
				)
				.map((r) => ({ table: str(r.table_name), displayField: str(r.display_field) })),
		set: async (db, table, column) => {
			if (column === '') {
				st.run(
					'DELETE FROM pma__table_info WHERE server = ? AND db_name = ? AND table_name = ?',
					st.server,
					db,
					table
				);
			} else {
				st.run(
					'INSERT INTO pma__table_info (server, db_name, table_name, display_field) VALUES (?, ?, ?, ?) ' +
						'ON CONFLICT (server, db_name, table_name) DO UPDATE SET display_field = excluded.display_field',
					st.server,
					db,
					table,
					column
				);
			}
		},
		transferTable: async (from, to, move) => {
			const s = move
				? {
						sql: 'UPDATE pma__table_info SET db_name = ?, table_name = ? WHERE server = ? AND db_name = ? AND table_name = ?',
						params: [to.db, to.table, st.server, from.db, from.table]
					}
				: {
						sql: 'INSERT OR IGNORE INTO pma__table_info (server, db_name, table_name, display_field) SELECT server, ?, ?, display_field FROM pma__table_info WHERE server = ? AND db_name = ? AND table_name = ?',
						params: [to.db, to.table, st.server, from.db, from.table]
					};
			st.run(s.sql, ...s.params);
			return [render(s.sql, s.params)];
		}
	};
}

const MIME_COLUMNS =
	'mimetype, transformation, transformation_options, input_transformation, input_transformation_options';

function columnInfo(st: SqliteStore): ColumnInfoRepo {
	const DB_COMMENT = '(db_comment)';
	return {
		ping,
		loadMime: async (db, table) =>
			st
				.all(
					`SELECT column_name, ${MIME_COLUMNS} FROM pma__column_info WHERE server = ? AND db_name = ? AND table_name = ? ` +
						`AND (mimetype != '' OR transformation != '' OR transformation_options != '' ` +
						`OR input_transformation != '' OR input_transformation_options != '')`,
					st.server,
					db,
					table
				)
				.map((r) => ({
					column: str(r.column_name),
					mimetype: str(r.mimetype),
					transformation: str(r.transformation),
					transformation_options: str(r.transformation_options),
					input_transformation: str(r.input_transformation),
					input_transformation_options: str(r.input_transformation_options)
				})),
		saveMime: async (db, table, entries) => {
			st.transaction(() => {
				for (const entry of entries) {
					const row = entry.row;
					if (entry.oldName && entry.oldName !== entry.column) {
						st.run(
							'UPDATE pma__column_info SET column_name = ? WHERE server = ? AND db_name = ? AND table_name = ? AND column_name = ?',
							entry.column,
							st.server,
							db,
							table,
							entry.oldName
						);
					}
					const hasValue = Object.values(row).some((v) => v.length > 0);
					const existing = st.get(
						'SELECT "comment" FROM pma__column_info WHERE server = ? AND db_name = ? AND table_name = ? AND column_name = ?',
						st.server,
						db,
						table,
						entry.column
					);
					const values = [
						row.mimetype,
						row.transformation,
						row.transformation_options,
						row.input_transformation,
						row.input_transformation_options
					];
					if (existing) {
						if (hasValue || str(existing.comment).length > 0) {
							st.run(
								'UPDATE pma__column_info SET mimetype = ?, transformation = ?, transformation_options = ?, input_transformation = ?, input_transformation_options = ? ' +
									'WHERE server = ? AND db_name = ? AND table_name = ? AND column_name = ?',
								...values,
								st.server,
								db,
								table,
								entry.column
							);
						} else {
							st.run(
								'DELETE FROM pma__column_info WHERE server = ? AND db_name = ? AND table_name = ? AND column_name = ?',
								st.server,
								db,
								table,
								entry.column
							);
						}
					} else if (hasValue) {
						st.run(
							`INSERT INTO pma__column_info (server, db_name, table_name, column_name, ${MIME_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
							st.server,
							db,
							table,
							entry.column,
							...values
						);
					}
				}
			});
		},
		getDbComment: async (db) =>
			str(
				st.get(
					`SELECT "comment" FROM pma__column_info WHERE server = ? AND db_name = ? AND table_name = '' AND column_name = ?`,
					st.server,
					db,
					DB_COMMENT
				)?.comment
			),
		setDbComment: async (db, comment) => {
			let sql: string;
			let params: (string | number)[];
			if (comment.length > 0) {
				sql =
					`INSERT INTO pma__column_info (server, db_name, table_name, column_name, "comment") VALUES (?, ?, '', ?, ?) ` +
					`ON CONFLICT (server, db_name, table_name, column_name) DO UPDATE SET "comment" = excluded."comment"`;
				params = [st.server, db, DB_COMMENT, comment];
			} else {
				sql = `DELETE FROM pma__column_info WHERE server = ? AND db_name = ? AND table_name = '' AND column_name = ?`;
				params = [st.server, db, DB_COMMENT];
			}
			st.run(sql, ...params);
			return [render(sql, params)];
		},
		listForDb: async (db) =>
			st
				.all(
					`SELECT table_name, column_name, "comment", mimetype FROM pma__column_info WHERE server = ? AND db_name = ? AND table_name <> ''`,
					st.server,
					db
				)
				.map((r) => ({
					table: str(r.table_name),
					column: str(r.column_name),
					comment: str(r.comment),
					mimetype: str(r.mimetype)
				})),
		transferDb: async (oldDb, newDb, move) => {
			const cols = `table_name, column_name, "comment", ${MIME_COLUMNS}`;
			const s = move
				? {
						sql: 'UPDATE pma__column_info SET db_name = ? WHERE server = ? AND db_name = ?',
						params: [newDb, st.server, oldDb]
					}
				: {
						sql: `INSERT INTO pma__column_info (server, db_name, ${cols}) SELECT server, ?, ${cols} FROM pma__column_info WHERE server = ? AND db_name = ?`,
						params: [newDb, st.server, oldDb]
					};
			st.run(s.sql, ...s.params);
			return [render(s.sql, s.params)];
		},
		transferTable: async (from, to, move) => {
			const cols = `column_name, "comment", ${MIME_COLUMNS}`;
			const s = move
				? {
						sql: 'UPDATE pma__column_info SET db_name = ?, table_name = ? WHERE server = ? AND db_name = ? AND table_name = ?',
						params: [to.db, to.table, st.server, from.db, from.table]
					}
				: {
						sql: `INSERT OR IGNORE INTO pma__column_info (server, db_name, table_name, ${cols}) SELECT server, ?, ?, ${cols} FROM pma__column_info WHERE server = ? AND db_name = ? AND table_name = ?`,
						params: [to.db, to.table, st.server, from.db, from.table]
					};
			st.run(s.sql, ...s.params);
			return [render(s.sql, s.params)];
		}
	};
}

function savedSearches(st: SqliteStore): SavedSearchesRepo {
	return {
		ping,
		list: async (user, db) =>
			st
				.all(
					'SELECT id, search_name, search_data FROM pma__savedsearches WHERE server = ? AND username = ? AND db_name = ? ORDER BY search_name',
					st.server,
					user,
					db
				)
				.map((r) => ({ id: Number(r.id), name: str(r.search_name), data: str(r.search_data) })),
		insert: async (user, db, name, json) =>
			st.run(
				'INSERT INTO pma__savedsearches (server, username, db_name, search_name, search_data) VALUES (?, ?, ?, ?, ?)',
				st.server,
				user,
				db,
				name,
				json
			).insertId,
		update: async (id, user, db, name, json) =>
			st.run(
				'UPDATE pma__savedsearches SET search_name = ?, search_data = ? WHERE server = ? AND id = ? AND username = ? AND db_name = ?',
				name,
				json,
				st.server,
				id,
				user,
				db
			).changes,
		delete: async (id, user, db) =>
			st.run(
				'DELETE FROM pma__savedsearches WHERE server = ? AND id = ? AND username = ? AND db_name = ?',
				st.server,
				id,
				user,
				db
			).changes
	};
}

function tableUiPrefs(st: SqliteStore): TableUiPrefsRepo {
	return {
		ping,
		get: async (user, db, table) => {
			const row = st.get(
				'SELECT prefs FROM pma__table_uiprefs WHERE server = ? AND username = ? AND db_name = ? AND table_name = ?',
				st.server,
				user,
				db,
				table
			);
			return row ? str(row.prefs) : null;
		},
		set: async (user, db, table, json) => {
			st.run(
				'INSERT INTO pma__table_uiprefs (server, username, db_name, table_name, prefs) VALUES (?, ?, ?, ?, ?) ' +
					`ON CONFLICT (server, username, db_name, table_name) DO UPDATE SET prefs = excluded.prefs, last_update = strftime('%Y-%m-%d %H:%M:%S', 'now', 'localtime')`,
				st.server,
				user,
				db,
				table,
				json
			);
		}
	};
}

function exportTemplates(st: SqliteStore): ExportTemplatesRepo {
	return {
		ping,
		list: async (user, type) =>
			st
				.all(
					'SELECT id, template_name FROM pma__export_templates WHERE server = ? AND username = ? AND export_type = ? ORDER BY template_name',
					st.server,
					user,
					type
				)
				.map((r) => ({ id: Number(r.id), name: str(r.template_name) })),
		get: async (id, user) => {
			const row = st.get(
				'SELECT template_data FROM pma__export_templates WHERE server = ? AND id = ? AND username = ?',
				st.server,
				id,
				user
			);
			return row ? str(row.template_data) : null;
		},
		create: async (user, type, name, json) =>
			st.run(
				'INSERT INTO pma__export_templates (server, username, export_type, template_name, template_data) VALUES (?, ?, ?, ?, ?)',
				st.server,
				user,
				type,
				name,
				json
			).insertId,
		update: async (id, user, json) =>
			st.run(
				'UPDATE pma__export_templates SET template_data = ? WHERE server = ? AND id = ? AND username = ?',
				json,
				st.server,
				id,
				user
			).changes > 0,
		delete: async (id, user) =>
			st.run(
				'DELETE FROM pma__export_templates WHERE server = ? AND id = ? AND username = ?',
				st.server,
				id,
				user
			).changes > 0
	};
}

/** Every feature is available on SQLite. */
export function sqliteRepos(st: SqliteStore): Repos {
	return {
		kind: 'sqlite',
		bookmarks: bookmarks(st),
		history: history(st),
		recent: recentFavorite(st, 'pma__recent'),
		favorite: recentFavorite(st, 'pma__favorite'),
		userConfig: userConfig(st),
		navigationHiding: navigationHiding(st),
		userGroups: userGroups(st),
		centralColumns: centralColumns(st),
		tracking: tracking(st),
		designerPages: designerPages(st),
		designerSettings: designerSettings(st),
		relation: relation(st),
		tableInfo: tableInfo(st),
		columnInfo: columnInfo(st),
		savedSearches: savedSearches(st),
		tableUiPrefs: tableUiPrefs(st),
		exportTemplates: exportTemplates(st)
	};
}
