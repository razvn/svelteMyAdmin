/**
 * Server-side loaders for the Database > Query pages: the schema (tables, columns, foreign keys,
 * `pma__relation`, indexes) and the saved searches (`pma__savedsearches`, feature-detected).
 */
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import { escapeQualified } from '#lib/server/db/escape.ts';
import { withControl } from '#lib/server/table/control.ts';
import type { QuerySchemaData } from '#lib/sql/query-schema.ts';

type Row = Record<string, unknown>;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

export async function loadQuerySchema(
	dbi: DatabaseInterface,
	locals: App.Locals,
	db: string
): Promise<QuerySchemaData> {
	const q = async (sql: string, params: unknown[]): Promise<Row[]> => {
		try {
			const [rows] = await dbi.conn.query(sql, params);
			return rows as Row[];
		} catch {
			return [];
		}
	};

	const tableRows = await dbi.listTables(db);
	const colRows = await q(
		'SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS ' +
			'WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION',
		[db]
	);
	const columns = new Map<string, string[]>();
	for (const r of colRows) {
		const list = columns.get(s(r.t)) ?? [];
		list.push(s(r.c));
		columns.set(s(r.t), list);
	}

	const fkRows = await q(
		'SELECT CONSTRAINT_NAME AS k, TABLE_NAME AS t, COLUMN_NAME AS c, REFERENCED_TABLE_NAME AS rt, ' +
			'REFERENCED_COLUMN_NAME AS rc FROM information_schema.KEY_COLUMN_USAGE ' +
			'WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL ' +
			'ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION',
		[db, db]
	);

	const idxRows = await q(
		'SELECT TABLE_NAME AS t, COLUMN_NAME AS c, NON_UNIQUE AS nu FROM information_schema.STATISTICS ' +
			'WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX',
		[db]
	);

	const server = locals.server;
	let internal: Row[] = [];
	if (server.pmadb && server.relation) {
		internal =
			(await withControl(locals, async (conn) => {
				const [rows] = await conn.query(
					'SELECT master_table, master_field, foreign_table, foreign_field FROM ' +
						escapeQualified(server.pmadb, server.relation) +
						' WHERE master_db = ? AND foreign_db = ?',
					[db, db]
				);
				return rows as Row[];
			})) ?? [];
	}

	return {
		tables: tableRows.map((t) => ({
			name: t.name,
			columns: columns.get(t.name) ?? [],
			rows: t.rows ?? 0
		})),
		foreignKeys: fkRows.map((r) => ({
			constraint: s(r.k),
			table: s(r.t),
			column: s(r.c),
			refTable: s(r.rt),
			refColumn: s(r.rc)
		})),
		internalRelations: internal.map((r) => ({
			table: s(r.master_table),
			field: s(r.master_field),
			refTable: s(r.foreign_table),
			refField: s(r.foreign_field)
		})),
		indexes: idxRows.map((r) => ({
			table: s(r.t),
			column: s(r.c),
			nonUnique: Number(r.nu) !== 0
		}))
	};
}

// ---- saved searches ------------------------------------------------------------------------

export interface SavedSearch {
	id: number;
	name: string;
	data: Record<string, unknown>;
}

/** True when the configuration storage is set up for saved searches. */
export function savedSearchesConfigured(locals: App.Locals): boolean {
	return Boolean(locals.server.pmadb && locals.server.savedsearches);
}

/** Saved searches of the current user and database; null when the feature is unavailable. */
export async function listSavedSearches(
	locals: App.Locals,
	db: string
): Promise<SavedSearch[] | null> {
	if (!savedSearchesConfigured(locals) || !locals.session) return null;
	const server = locals.server;
	const user = locals.session.user;
	const rows = await withControl(locals, async (conn) => {
		const [r] = await conn.query(
			'SELECT id, search_name, search_data FROM ' +
				escapeQualified(server.pmadb, server.savedsearches) +
				' WHERE username = ? AND db_name = ? ORDER BY search_name',
			[user, db]
		);
		return r as Row[];
	});
	if (!rows) return null;
	return rows.flatMap((r) => {
		try {
			const data = JSON.parse(s(r.search_data));
			if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
			return [{ id: Number(r.id), name: s(r.search_name), data }];
		} catch {
			return [];
		}
	});
}

export type SaveResult = { ok: true; id: number } | { ok: false; error: string };

/** Insert (no id) or update (id) a saved search. */
export async function saveSearch(
	locals: App.Locals,
	db: string,
	input: { id?: number; name: string; data: Record<string, unknown> }
): Promise<SaveResult> {
	if (!savedSearchesConfigured(locals) || !locals.session) {
		return { ok: false, error: locals.i18n.t('Saved searches are not available.') };
	}
	const server = locals.server;
	const table = escapeQualified(server.pmadb, server.savedsearches);
	const user = locals.session.user;
	const json = JSON.stringify(input.data);
	try {
		const res = await withControl(locals, async (conn) => {
			if (input.id !== undefined) {
				const [r] = await conn.query(
					`UPDATE ${table} SET search_name = ?, search_data = ? WHERE id = ? AND username = ? AND db_name = ?`,
					[input.name, json, input.id, user, db]
				);
				return { id: input.id, affected: (r as { affectedRows: number }).affectedRows };
			}
			const [r] = await conn.query(
				`INSERT INTO ${table} (username, db_name, search_name, search_data) VALUES (?, ?, ?, ?)`,
				[user, db, input.name, json]
			);
			return { id: Number((r as { insertId: number }).insertId), affected: 1 };
		});
		if (!res)
			return { ok: false, error: locals.i18n.t('The configuration storage is not reachable.') };
		if (res.affected === 0)
			return { ok: false, error: locals.i18n.t('The saved search no longer exists.') };
		return { ok: true, id: res.id };
	} catch {
		return {
			ok: false,
			error: locals.i18n.t('Could not save the search (is the name already used?).')
		};
	}
}

export async function deleteSearch(
	locals: App.Locals,
	db: string,
	id: number
): Promise<{ ok: boolean }> {
	if (!savedSearchesConfigured(locals) || !locals.session) return { ok: false };
	const server = locals.server;
	const res = await withControl(locals, async (conn) => {
		const [r] = await conn.query(
			`DELETE FROM ${escapeQualified(server.pmadb, server.savedsearches)} WHERE id = ? AND username = ? AND db_name = ?`,
			[id, locals.session!.user, db]
		);
		return (r as { affectedRows: number }).affectedRows;
	});
	return { ok: (res ?? 0) > 0 };
}
