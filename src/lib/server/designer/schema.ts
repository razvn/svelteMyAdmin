/**
 * Loads what the Designer shows for a database (Designer/Common.php getTablesInfo, getColumnsInfo,
 * getScriptContr): base tables with their columns and keys, InnoDB foreign keys and the internal
 * relations of `pma__relation`, and the display fields of `pma__table_info`.
 * Relations that point to another database are not drawn.
 */
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import { storageRepos } from '#lib/server/storage/index.ts';
import { detectStorage, type RelationServer } from '#lib/server/table/relation.ts';
import type { DesignerRelation, DesignerTable } from '#lib/designer/types.ts';

type Row = Record<string, unknown>;
const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export interface DesignerSchema {
	tables: DesignerTable[];
	relations: DesignerRelation[];
	/** `pma__relation` / `pma__table_info` are usable. */
	storage: { relation: boolean; tableInfo: boolean };
}

async function rows(dbi: DatabaseInterface, sql: string, params: unknown[]): Promise<Row[]> {
	const [r] = await dbi.conn.query(sql, params);
	return r as Row[];
}

export async function loadDesignerSchema(
	dbi: DatabaseInterface,
	server: RelationServer,
	db: string
): Promise<DesignerSchema> {
	const [tableRows, columnRows, fkRows, indexRows, storage] = await Promise.all([
		rows(
			dbi,
			'SELECT TABLE_NAME AS name, ENGINE AS engine FROM information_schema.TABLES ' +
				"WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
			[db]
		),
		rows(
			dbi,
			'SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS type, COLUMN_KEY AS k, ' +
				'IS_NULLABLE AS nullable, COLUMN_DEFAULT AS def FROM information_schema.COLUMNS ' +
				'WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION',
			[db]
		),
		rows(
			dbi,
			'SELECT k.TABLE_NAME AS t, k.CONSTRAINT_NAME AS cname, k.COLUMN_NAME AS col, ' +
				'k.ORDINAL_POSITION AS ord, k.REFERENCED_TABLE_SCHEMA AS rdb, k.REFERENCED_TABLE_NAME AS rt, ' +
				'k.REFERENCED_COLUMN_NAME AS rc, r.DELETE_RULE AS del, r.UPDATE_RULE AS upd ' +
				'FROM information_schema.KEY_COLUMN_USAGE k ' +
				'JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA ' +
				'AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME AND r.TABLE_NAME = k.TABLE_NAME ' +
				'WHERE k.TABLE_SCHEMA = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL ' +
				'ORDER BY k.TABLE_NAME, k.CONSTRAINT_NAME, k.ORDINAL_POSITION',
			[db]
		),
		rows(
			dbi,
			'SELECT TABLE_NAME AS t, COLUMN_NAME AS c, NON_UNIQUE AS nu FROM information_schema.STATISTICS ' +
				'WHERE TABLE_SCHEMA = ?',
			[db]
		),
		detectStorage(dbi, server)
	]);

	const unique = new Set<string>();
	const indexed = new Set<string>();
	for (const r of indexRows) {
		(Number(r.nu) === 0 ? unique : indexed).add(`${s(r.t)}\0${s(r.c)}`);
	}

	const relations: DesignerRelation[] = [];
	const counters = new Map<string, number>();
	for (const r of fkRows) {
		if (s(r.rdb) !== db) continue;
		const key = `${s(r.t)}:${s(r.cname)}`;
		const n = counters.get(key) ?? 0;
		counters.set(key, n + 1);
		relations.push({
			id: `fk:${key}:${n}`,
			kind: 'fk',
			fromTable: s(r.t),
			fromColumn: s(r.col),
			toTable: s(r.rt),
			toColumn: s(r.rc),
			constraint: s(r.cname),
			onDelete: s(r.del),
			onUpdate: s(r.upd)
		});
	}

	const displayFields = new Map<string, string>();
	const repos = storageRepos(server, async () => dbi.conn);
	if (storage.relation && repos.relation) {
		const internal = await repos.relation.listForDb(db).catch(() => []);
		for (const r of internal) {
			if (r.refDb !== db) continue;
			// an InnoDB foreign key of the same column wins over the internal relation
			if (
				relations.some(
					(x) => x.kind === 'fk' && x.fromTable === r.masterTable && x.fromColumn === r.column
				)
			) {
				continue;
			}
			relations.push({
				id: `internal:${r.masterTable}:${r.column}`,
				kind: 'internal',
				fromTable: r.masterTable,
				fromColumn: r.column,
				toTable: r.refTable,
				toColumn: r.refColumn
			});
		}
	}
	if (storage.tableInfo && repos.tableInfo) {
		const info = await repos.tableInfo.listForDb(db).catch(() => []);
		for (const r of info) displayFields.set(r.table, r.displayField);
	}

	const names = new Set(tableRows.map((r) => s(r.name)));
	const visible = relations.filter((r) => names.has(r.fromTable) && names.has(r.toTable));
	const foreign = new Set(visible.map((r) => `${r.fromTable}\0${r.fromColumn}`));

	const tables: DesignerTable[] = tableRows.map((t) => {
		const name = s(t.name);
		return {
			name,
			engine: t.engine === null || t.engine === undefined ? null : s(t.engine),
			displayField: displayFields.get(name) ?? '',
			columns: columnRows
				.filter((c) => s(c.t) === name)
				.map((c) => {
					const col = s(c.c);
					const key = `${name}\0${col}`;
					return {
						name: col,
						type: s(c.type),
						nullable: s(c.nullable) === 'YES',
						default: c.def === null || c.def === undefined ? null : s(c.def),
						primary: s(c.k) === 'PRI',
						unique: unique.has(key) && s(c.k) !== 'PRI',
						indexed: indexed.has(key) && !unique.has(key) && s(c.k) !== 'PRI',
						foreign: foreign.has(key)
					};
				})
		};
	});
	return {
		tables,
		relations: visible,
		storage: { relation: storage.relation, tableInfo: storage.tableInfo }
	};
}
