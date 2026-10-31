/**
 * Server-side loaders for the Database > Query pages: the schema (tables, columns, foreign keys,
 * `pma__relation`, indexes) and the saved searches (`pma__savedsearches`, feature-detected).
 */
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import { withRepo, hasRepo } from '#lib/server/storage/index.ts';
import type { QuerySchemaData } from '#lib/sql/query-schema.ts';
import { SOURCE_TRANSLATOR } from '#lib/i18n/translator.ts';

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

	// internal relations inside this database (both ends in `db`)
	const internal =
		(await withRepo(locals, 'relation', (repo) => repo.listForDb(db)))?.filter(
			(r) => r.refDb === db
		) ?? [];

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
			table: r.masterTable,
			field: r.column,
			refTable: r.refTable,
			refField: r.refColumn
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
	return hasRepo(locals.server, 'savedSearches');
}

/** Saved searches of the current user and database; null when the feature is unavailable. */
export async function listSavedSearches(
	locals: App.Locals,
	db: string
): Promise<SavedSearch[] | null> {
	if (!savedSearchesConfigured(locals) || !locals.session) return null;
	const user = locals.session.user;
	const rows = await withRepo(locals, 'savedSearches', (repo) => repo.list(user, db));
	if (!rows) return null;
	return rows.flatMap((r) => {
		try {
			const data = JSON.parse(r.data);
			if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
			return [{ id: r.id, name: r.name, data }];
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
	const tr = locals.i18n ?? SOURCE_TRANSLATOR;
	if (!savedSearchesConfigured(locals) || !locals.session) {
		return { ok: false, error: tr.t('Saved searches are not available.') };
	}
	const user = locals.session.user;
	const json = JSON.stringify(input.data);
	try {
		const res = await withRepo(locals, 'savedSearches', async (repo) => {
			if (input.id !== undefined) {
				return {
					id: input.id,
					affected: await repo.update(input.id, user, db, input.name, json)
				};
			}
			return { id: await repo.insert(user, db, input.name, json), affected: 1 };
		});
		if (!res) return { ok: false, error: tr.t('The configuration storage is not reachable.') };
		if (res.affected === 0) return { ok: false, error: tr.t('The saved search no longer exists.') };
		return { ok: true, id: res.id };
	} catch {
		return {
			ok: false,
			error: tr.t('Could not save the search (is the name already used?).')
		};
	}
}

export async function deleteSearch(
	locals: App.Locals,
	db: string,
	id: number
): Promise<{ ok: boolean }> {
	if (!savedSearchesConfigured(locals) || !locals.session) return { ok: false };
	const user = locals.session.user;
	const res = await withRepo(locals, 'savedSearches', (repo) => repo.delete(id, user, db));
	return { ok: (res ?? 0) > 0 };
}
