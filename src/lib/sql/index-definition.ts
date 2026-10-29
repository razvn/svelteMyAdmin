/**
 * Index definitions: model, ALTER TABLE builders and SHOW INDEX grouping.
 *
 * Pure module shared by the browser (SQL preview) and the server actions. Ported from
 * phpMyAdmin 5.2.3: Index::getSqlQuery()/getCompareData(), Controllers/Table/IndexesController.php,
 * Structure/{Primary,Unique,Spatial,Fulltext,AddKey}Controller.php and IndexRenameController.php.
 */
import { escapeStr, isMariaDb, quoteId, type ServerCaps } from './column-definition.ts';
import { SOURCE_TRANSLATOR, type Translator } from '#lib/i18n/translator.ts';

export type IndexKind = 'PRIMARY' | 'UNIQUE' | 'INDEX' | 'FULLTEXT' | 'SPATIAL';
export const INDEX_KINDS: readonly IndexKind[] = [
	'PRIMARY',
	'UNIQUE',
	'INDEX',
	'FULLTEXT',
	'SPATIAL'
];
export const INDEX_TYPES = ['', 'BTREE', 'HASH'] as const;
export type IndexStorageType = (typeof INDEX_TYPES)[number];

export interface IndexColumn {
	name: string;
	/** Sub-part length (`col(10)`); empty for the whole column. */
	size: string;
}

export interface IndexDef {
	/** Empty = let the server name it (ignored for PRIMARY). */
	name: string;
	kind: IndexKind;
	columns: IndexColumn[];
	keyBlockSize: string;
	indexType: IndexStorageType;
	parser: string;
	comment: string;
	/** INVISIBLE on MySQL 8, IGNORED on MariaDB 10.6+. */
	invisible: boolean;
}

export function newIndexDef(overrides: Partial<IndexDef> = {}): IndexDef {
	return {
		name: '',
		kind: 'INDEX',
		columns: [],
		keyBlockSize: '',
		indexType: '',
		parser: '',
		comment: '',
		invisible: false,
		...overrides
	};
}

const tableRef = (db: string, table: string): string => `${quoteId(db)}.${quoteId(table)}`;

/** MySQL 8.0 INVISIBLE / MariaDB 10.6 IGNORED indexes. */
export const supportsInvisibleIndex = (caps: ServerCaps): boolean =>
	isMariaDb(caps) ? caps.version >= 100600 : caps.version >= 80000;

export const invisibleKeyword = (caps: ServerCaps): string =>
	isMariaDb(caps) ? 'IGNORED' : 'INVISIBLE';

/** ALTER TABLE ... RENAME INDEX: MySQL 5.7, MariaDB 10.5.2. */
export const supportsRenameIndex = (caps: ServerCaps): boolean =>
	isMariaDb(caps) ? caps.version >= 100502 : caps.version >= 50700;

/** Validation shared by the editor dialog and the server action. Returns an error or null. */
export function validateIndexDef(
	def: IndexDef,
	tableColumns?: string[],
	tr: Pick<Translator, 't'> = SOURCE_TRANSLATOR
): string | null {
	if (def.columns.length === 0) return tr.t('The index needs at least one column.');
	if (def.columns.some((c) => c.name === '')) return tr.t('Choose a column for every index part.');
	const seen = new Set<string>();
	for (const c of def.columns) {
		if (seen.has(c.name)) return tr.t('Column {name} is used twice.', { name: c.name });
		seen.add(c.name);
		if (c.size !== '' && !/^[1-9]\d{0,5}$/.test(c.size)) {
			return tr.t('Invalid sub-part length for {name}.', { name: c.name });
		}
		if (c.size !== '' && (def.kind === 'FULLTEXT' || def.kind === 'SPATIAL')) {
			return tr.t('{kind} index parts cannot have a length.', { kind: def.kind });
		}
		if (tableColumns && !tableColumns.includes(c.name)) return tr.t('Unknown column {name}.', { name: c.name });
	}
	if (def.name.length > 64) return tr.t('The index name is too long.');
	if (def.kind === 'PRIMARY' && def.name !== '' && def.name !== 'PRIMARY') {
		return tr.t('The name of a PRIMARY KEY must be "PRIMARY".');
	}
	if (def.keyBlockSize !== '' && !/^\d{1,5}$/.test(def.keyBlockSize)) {
		return tr.t('Invalid key block size.');
	}
	if (def.parser !== '' && def.kind !== 'FULLTEXT') return tr.t('A parser is only for FULLTEXT indexes.');
	if (def.parser !== '' && !/^[A-Za-z0-9_$]+$/.test(def.parser)) return tr.t('Invalid parser name.');
	if (def.indexType !== '' && (def.kind === 'FULLTEXT' || def.kind === 'SPATIAL')) {
		return tr.t('{kind} indexes have no BTREE/HASH type.', { kind: def.kind });
	}
	if (def.kind === 'PRIMARY' && def.invisible) return tr.t('A PRIMARY KEY cannot be invisible.');
	return null;
}

/** Key parts: `` `a`, `b`(10) ``. */
export function buildKeyParts(columns: IndexColumn[]): string {
	return columns
		.map(
			(c) => quoteId(c.name) + (c.size !== '' && Number(c.size) > 0 ? `(${Number(c.size)})` : '')
		)
		.join(', ');
}

/** The part after `ADD`, e.g. ``UNIQUE `name` (`a`(10), `b`) KEY_BLOCK_SIZE = 4 COMMENT 'x'``. */
export function buildIndexClause(def: IndexDef, caps: ServerCaps): string {
	let sql = def.kind === 'PRIMARY' ? 'PRIMARY KEY' : def.kind === 'INDEX' ? 'INDEX' : def.kind;
	if (def.kind !== 'PRIMARY' && def.name !== '') sql += ` ${quoteId(def.name)}`;
	sql += ` (${buildKeyParts(def.columns)})`;
	if (def.indexType !== '' && def.kind !== 'FULLTEXT' && def.kind !== 'SPATIAL') {
		sql += ` USING ${def.indexType}`;
	}
	if (def.keyBlockSize !== '' && Number(def.keyBlockSize) > 0) {
		sql += ` KEY_BLOCK_SIZE = ${Number(def.keyBlockSize)}`;
	}
	if (def.parser !== '' && def.kind === 'FULLTEXT') sql += ` WITH PARSER ${quoteId(def.parser)}`;
	if (def.comment !== '') sql += ` COMMENT '${escapeStr(def.comment)}'`;
	if (def.invisible && def.kind !== 'PRIMARY' && supportsInvisibleIndex(caps)) {
		sql += ` ${invisibleKeyword(caps)}`;
	}
	return sql;
}

const dropClause = (name: string, kind: IndexKind): string =>
	kind === 'PRIMARY' ? 'DROP PRIMARY KEY' : `DROP INDEX ${quoteId(name)}`;

/**
 * Create an index, or replace `original` (edit = DROP + ADD in one atomic ALTER, like phpMyAdmin).
 */
export function buildSaveIndex(
	db: string,
	table: string,
	def: IndexDef,
	original: { name: string; kind: IndexKind } | null,
	caps: ServerCaps
): string {
	const clauses: string[] = [];
	if (original) clauses.push(dropClause(original.name, original.kind));
	clauses.push(`ADD ${buildIndexClause(def, caps)}`);
	return `ALTER TABLE ${tableRef(db, table)}\n  ${clauses.join(',\n  ')};`;
}

export function buildDropIndex(db: string, table: string, name: string, kind: IndexKind): string {
	return `ALTER TABLE ${tableRef(db, table)} ${dropClause(name, kind)};`;
}

export function buildRenameIndex(db: string, table: string, from: string, to: string): string {
	return `ALTER TABLE ${tableRef(db, table)} RENAME INDEX ${quoteId(from)} TO ${quoteId(to)};`;
}

/**
 * The column shortcuts (Primary / Unique / Index / Spatial / Fulltext): one index over all the
 * selected columns. A new PRIMARY KEY replaces the existing one when `replacePrimary`.
 */
export function buildAddKey(
	db: string,
	table: string,
	kind: IndexKind,
	columns: string[],
	opts: { replacePrimary?: boolean } = {}
): string {
	const parts = columns.map(quoteId).join(', ');
	const head = kind === 'PRIMARY' ? 'PRIMARY KEY' : kind;
	const drop = kind === 'PRIMARY' && opts.replacePrimary ? 'DROP PRIMARY KEY, ' : '';
	return `ALTER TABLE ${tableRef(db, table)} ${drop}ADD ${head} (${parts});`;
}

// --- SHOW INDEX grouping (Index::getFromTable / Index::getCompareData) ---

/** One `SHOW INDEX` row. */
export interface IndexRow {
	keyName: string;
	nonUnique: boolean;
	seqInIndex: number;
	columnName: string | null;
	collation: string | null;
	cardinality: number | null;
	subPart: number | null;
	packed: string | null;
	nullable: boolean;
	indexType: string;
	comment: string;
	indexComment: string;
	expression: string | null;
	/** MySQL 8 `Visible` / MariaDB `Ignored` (inverted by the loader). */
	visible: boolean;
}

export interface ParsedIndexColumn {
	/** null for a functional key part. */
	name: string | null;
	expression: string | null;
	subPart: number | null;
	collation: string | null;
	cardinality: number | null;
	nullable: boolean;
}

export interface ParsedIndex {
	name: string;
	kind: IndexKind;
	/** BTREE, HASH, FULLTEXT, SPATIAL (as reported by the server). */
	indexType: string;
	unique: boolean;
	packed: string | null;
	comment: string;
	indexComment: string;
	visible: boolean;
	columns: ParsedIndexColumn[];
	keyBlockSize: string;
	parser: string;
	/** Functional key parts cannot be edited with the column editor. */
	editable: boolean;
}

export function groupIndexes(
	rows: IndexRow[],
	options: Record<string, { keyBlockSize?: string; parser?: string }> = {}
): ParsedIndex[] {
	const map = new Map<string, ParsedIndex>();
	const sorted = [...rows].sort((a, b) => a.seqInIndex - b.seqInIndex);
	for (const r of sorted) {
		let idx = map.get(r.keyName);
		if (!idx) {
			const type = r.indexType.toUpperCase();
			const kind: IndexKind =
				r.keyName === 'PRIMARY'
					? 'PRIMARY'
					: type === 'FULLTEXT'
						? 'FULLTEXT'
						: type === 'SPATIAL'
							? 'SPATIAL'
							: r.nonUnique
								? 'INDEX'
								: 'UNIQUE';
			idx = {
				name: r.keyName,
				kind,
				indexType: r.indexType,
				unique: !r.nonUnique,
				packed: r.packed,
				comment: r.comment,
				indexComment: r.indexComment,
				visible: r.visible,
				columns: [],
				keyBlockSize: options[r.keyName]?.keyBlockSize ?? '',
				parser: options[r.keyName]?.parser ?? '',
				editable: true
			};
			map.set(r.keyName, idx);
		}
		if (r.columnName === null) idx.editable = false;
		idx.columns.push({
			name: r.columnName,
			expression: r.expression,
			subPart: r.subPart,
			collation: r.collation,
			cardinality: r.cardinality,
			nullable: r.nullable
		});
	}
	return [...map.values()];
}

/** The editor model of an existing index. */
export function indexToDef(idx: ParsedIndex): IndexDef {
	return newIndexDef({
		name: idx.name,
		kind: idx.kind,
		columns: idx.columns.map((c) => ({
			name: c.name ?? '',
			size: c.subPart ? String(c.subPart) : ''
		})),
		keyBlockSize: idx.keyBlockSize,
		indexType: idx.indexType === 'BTREE' || idx.indexType === 'HASH' ? idx.indexType : '',
		parser: idx.parser,
		comment: idx.indexComment,
		invisible: !idx.visible
	});
}

/**
 * `KEY_BLOCK_SIZE` and `WITH PARSER` of every key, read from a SHOW CREATE TABLE statement (SHOW
 * INDEX does not report them).
 */
export function parseKeyOptions(
	createSql: string
): Record<string, { keyBlockSize?: string; parser?: string }> {
	const out: Record<string, { keyBlockSize?: string; parser?: string }> = {};
	for (const line of createSql.split('\n')) {
		const m = line.match(/^\s*(?:(?:UNIQUE|FULLTEXT|SPATIAL) )?KEY `((?:[^`]|``)+)`/);
		if (!m) continue;
		const name = m[1].replaceAll('``', '`');
		const rest = line.slice(m[0].length);
		const kbs = rest.match(/KEY_BLOCK_SIZE=(\d+)/);
		const parser = rest.match(/WITH PARSER `((?:[^`]|``)+)`/);
		if (kbs || parser) {
			out[name] = {
				...(kbs ? { keyBlockSize: kbs[1] } : {}),
				...(parser ? { parser: parser[1].replaceAll('``', '`') } : {})
			};
		}
	}
	return out;
}
