/**
 * Database > Data dictionary (Controllers/Database/DataDictionaryController.php).
 */
import type { Connection } from 'mysql2/promise';
import type { DatabaseInterface, IndexInfo } from '../db/dbi';
import { storageRepos } from '#lib/server/storage/index.ts';
import { getDbComment, hasColumnInfo, type StorageServer } from './operations';

type Row = Record<string, unknown>;
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export interface DictionaryColumn {
	name: string;
	isPrimary: boolean;
	type: string;
	nullable: boolean;
	default: string | null;
	/** `table -> column` */
	relation: string;
	comment: string;
	mime: string;
}

export interface DictionaryIndex {
	name: string;
	type: string;
	unique: boolean;
	packed: string;
	comment: string;
	columns: {
		name: string;
		subPart: number | null;
		cardinality: number | null;
		collation: string;
		nullable: string;
	}[];
}

export interface DictionaryTable {
	name: string;
	comment: string;
	hasRelation: boolean;
	hasMime: boolean;
	columns: DictionaryColumn[];
	indexes: DictionaryIndex[];
}

export interface DataDictionary {
	database: string;
	comment: string;
	tables: DictionaryTable[];
}

/** Group `SHOW INDEXES` rows per key name (phpMyAdmin Index::getFromTable). */
export function groupIndexes(rows: IndexInfo[]): DictionaryIndex[] {
	const byName = new Map<string, DictionaryIndex>();
	for (const r of [...rows].sort((a, b) => a.seqInIndex - b.seqInIndex)) {
		let idx = byName.get(r.keyName);
		if (!idx) {
			idx = {
				name: r.keyName,
				type: r.indexType,
				unique: !r.nonUnique,
				packed: r.packed ?? '',
				comment: [r.comment, r.indexComment].filter(Boolean).join(' '),
				columns: []
			};
			byName.set(r.keyName, idx);
		}
		idx.columns.push({
			name: r.columnName ?? r.expression ?? '',
			subPart: r.subPart,
			cardinality: r.cardinality,
			collation: r.collation === 'A' ? 'A' : r.collation === 'D' ? 'D' : '',
			nullable: r.nullable ? 'YES' : 'NO'
		});
	}
	return [...byName.values()];
}

/** `pma__column_info` mimetype is stored with `_` instead of `/`. */
export const mimeFromStorage = (m: string): string => m.replaceAll('_', '/');

async function foreignKeys(conn: Connection, db: string): Promise<Map<string, string>> {
	const [res] = await conn.query(
		'SELECT TABLE_NAME AS t, COLUMN_NAME AS c, REFERENCED_TABLE_SCHEMA AS rs, ' +
			'REFERENCED_TABLE_NAME AS rt, REFERENCED_COLUMN_NAME AS rc ' +
			'FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA = ? AND REFERENCED_TABLE_NAME IS NOT NULL',
		[db]
	);
	const out = new Map<string, string>();
	for (const r of res as Row[]) {
		const target = str(r.rs) === db ? str(r.rt) : `${str(r.rs)}.${str(r.rt)}`;
		out.set(`${str(r.t)}\0${str(r.c)}`, `${target} -> ${str(r.rc)}`);
	}
	return out;
}

export async function loadDataDictionary(
	dbi: DatabaseInterface,
	server: StorageServer,
	db: string
): Promise<DataDictionary> {
	const storage = await hasColumnInfo(dbi, server);
	const comment = storage ? await getDbComment(dbi, server, db).catch(() => '') : '';
	const relations = await foreignKeys(dbi.conn, db);

	// pmadb: internal relations, column comments and MIME types
	const pmaComments = new Map<string, string>();
	const pmaMime = new Map<string, string>();
	if (storage) {
		const repos = storageRepos(server, async () => dbi.conn);
		try {
			for (const r of (await repos.columnInfo?.listForDb(db)) ?? []) {
				if (r.comment) pmaComments.set(`${r.table}\0${r.column}`, r.comment);
				if (r.mimetype) pmaMime.set(`${r.table}\0${r.column}`, mimeFromStorage(r.mimetype));
			}
		} catch {
			// column info not available
		}
		try {
			for (const r of (await repos.relation?.listForDb(db)) ?? []) {
				const key = `${r.masterTable}\0${r.column}`;
				if (relations.has(key)) continue;
				const target = r.refDb === db ? r.refTable : `${r.refDb}.${r.refTable}`;
				relations.set(key, `${target} -> ${r.refColumn}`);
			}
		} catch {
			// relation table not available
		}
	}

	const tables: DictionaryTable[] = [];
	for (const t of await dbi.listTables(db)) {
		const [cols, idx] = await Promise.all([dbi.getColumns(db, t.name), dbi.getIndexes(db, t.name)]);
		const indexes = groupIndexes(idx);
		const primary = new Set(
			indexes.filter((i) => i.name === 'PRIMARY').flatMap((i) => i.columns.map((c) => c.name))
		);
		const hasRelation = cols.some((c) => relations.has(`${t.name}\0${c.field}`));
		tables.push({
			name: t.name,
			comment: t.comment,
			hasRelation,
			hasMime: storage,
			columns: cols.map((c) => ({
				name: c.field,
				isPrimary: primary.has(c.field),
				type: c.type,
				nullable: c.null,
				default: c.default,
				relation: relations.get(`${t.name}\0${c.field}`) ?? '',
				comment: pmaComments.get(`${t.name}\0${c.field}`) ?? c.comment,
				mime: pmaMime.get(`${t.name}\0${c.field}`) ?? ''
			})),
			indexes
		});
	}
	return { database: db, comment, tables };
}
