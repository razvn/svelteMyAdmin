/**
 * Column definition model and CREATE TABLE builder.
 *
 * Pure module (no server imports) shared by the browser (live "Preview SQL") and the server action
 * that executes the statement. Ported from phpMyAdmin 5.2.3: Table::generateFieldSpec(),
 * CreateAddField::getTableCreationQuery(), Types::getColumns()/getAttributes() and the
 * Query\Compatibility checks.
 */

export type ServerKind = 'MySQL' | 'MariaDB' | 'Percona Server';

/** What the connected server supports (derived from `DatabaseInterface::getServerInfo()`). */
export interface ServerCaps {
	serverType: ServerKind;
	/** Numeric version, e.g. 80404 for 8.4.4 or 110406 for 11.4.6. */
	version: number;
}

export const isMariaDb = (caps: ServerCaps): boolean => caps.serverType === 'MariaDB';

// --- identifier / string escaping (same rules as server/db/escape.ts, duplicated to stay pure) ---

export function quoteId(name: string): string {
	return '`' + name.replaceAll('`', '``') + '`';
}

const STRING_ESCAPES: Record<string, string> = {
	'\0': '\\0',
	'\n': '\\n',
	'\r': '\\r',
	'\\': '\\\\',
	"'": "\\'",
	'"': '\\"',
	'\x1a': '\\Z'
};

export function escapeStr(value: string): string {
	// eslint-disable-next-line no-control-regex
	return value.replace(/[\0\n\r\\'"\x1a]/g, (c) => STRING_ESCAPES[c]);
}

const quoteStr = (value: string): string => `'${escapeStr(value)}'`;

// --- type catalog (Types::getColumns) ---

export interface TypeGroup {
	label: string;
	types: string[];
}

export const NUMERIC_TYPES = [
	'TINYINT',
	'SMALLINT',
	'MEDIUMINT',
	'INT',
	'BIGINT',
	'DECIMAL',
	'FLOAT',
	'DOUBLE',
	'REAL',
	'BIT',
	'BOOLEAN',
	'SERIAL'
];
export const DATETIME_TYPES = ['DATE', 'DATETIME', 'TIMESTAMP', 'TIME', 'YEAR'];
export const SPATIAL_TYPES = [
	'GEOMETRY',
	'POINT',
	'LINESTRING',
	'POLYGON',
	'MULTIPOINT',
	'MULTILINESTRING',
	'MULTIPOLYGON',
	'GEOMETRYCOLLECTION'
];

export const isUuidSupported = (caps: ServerCaps): boolean =>
	isMariaDb(caps) && caps.version >= 100700;

/** MySQL >= 8.0.18 ignores the display width of integer types (except TINYINT(1)). */
export const isIntegersLengthRestricted = (caps: ServerCaps): boolean =>
	caps.serverType === 'MySQL' && caps.version >= 80018;

export const isVirtualColumnsSupported = (caps: ServerCaps): boolean =>
	isMariaDb(caps) ? caps.version >= 50200 : caps.version >= 50706;

export const supportsStoredKeyword = (caps: ServerCaps): boolean =>
	isMariaDb(caps) ? caps.version >= 100201 : caps.version >= 50706;

export const supportsCompressedColumns = (caps: ServerCaps): boolean =>
	isMariaDb(caps) && caps.version >= 100100;

/** Type groups of the type `<select>`, filtered for the server flavour/version. */
export function getTypeGroups(caps: ServerCaps): TypeGroup[] {
	const maria = isMariaDb(caps);
	const string = [
		'CHAR',
		'VARCHAR',
		'TINYTEXT',
		'TEXT',
		'MEDIUMTEXT',
		'LONGTEXT',
		'BINARY',
		'VARBINARY',
		'TINYBLOB',
		'BLOB',
		'MEDIUMBLOB',
		'LONGBLOB',
		'ENUM',
		'SET'
	];
	if (maria && caps.version >= 100500) string.push('INET6');
	const groups: TypeGroup[] = [
		{ label: 'Numeric', types: NUMERIC_TYPES },
		{ label: 'Date and time', types: DATETIME_TYPES },
		{ label: 'String', types: string },
		{ label: 'Spatial', types: SPATIAL_TYPES }
	];
	if ((maria && caps.version > 100207) || (!maria && caps.version >= 50708)) {
		groups.push({ label: 'JSON', types: ['JSON'] });
	}
	if (isUuidSupported(caps)) groups.push({ label: 'UUID', types: ['UUID'] });
	return groups;
}

export const getAllTypes = (caps: ServerCaps): string[] =>
	getTypeGroups(caps).flatMap((g) => g.types);

/** Column attributes (Types::getAttributes). The empty value means "no attribute". */
export function getAttributes(caps: ServerCaps): string[] {
	const list = ['BINARY', 'UNSIGNED', 'UNSIGNED ZEROFILL', 'on update CURRENT_TIMESTAMP'];
	if (supportsCompressedColumns(caps)) list.push('COMPRESSED=zlib');
	return list;
}

export const VIRTUALITIES = ['VIRTUAL', 'STORED', 'PERSISTENT'] as const;

/** Virtuality choices: VIRTUAL plus STORED (or PERSISTENT on servers without the keyword). */
export function getVirtualities(caps: ServerCaps): string[] {
	return ['VIRTUAL', supportsStoredKeyword(caps) ? 'STORED' : 'PERSISTENT'];
}

export const TEXT_TYPES = [
	'TINYTEXT',
	'TEXT',
	'MEDIUMTEXT',
	'LONGTEXT',
	'VARCHAR',
	'CHAR',
	'ENUM',
	'SET'
];
export const hasCollation = (type: string): boolean => TEXT_TYPES.includes(type.toUpperCase());
export const isEnumOrSet = (type: string): boolean => /^(ENUM|SET)$/i.test(type);
const isTimestampLike = (type: string): boolean => /TIMESTAMP|DATETIME/i.test(type);

// --- model ---

export type DefaultType = 'NONE' | 'USER_DEFINED' | 'NULL' | 'CURRENT_TIMESTAMP' | 'UUID';
export const DEFAULT_TYPES: readonly DefaultType[] = [
	'NONE',
	'USER_DEFINED',
	'NULL',
	'CURRENT_TIMESTAMP',
	'UUID'
];
export type IndexChoice = '' | 'PRIMARY' | 'UNIQUE' | 'INDEX' | 'FULLTEXT' | 'SPATIAL';
export const INDEX_CHOICES: readonly IndexChoice[] = [
	'',
	'PRIMARY',
	'UNIQUE',
	'INDEX',
	'FULLTEXT',
	'SPATIAL'
];

export interface ColumnDef {
	/** Client-side key for keyed `{#each}`; not part of the SQL. */
	id: number;
	name: string;
	type: string;
	/** Length/values: `10`, `10,2`, `'a','b'`. */
	length: string;
	defaultType: DefaultType;
	defaultValue: string;
	collation: string;
	attribute: string;
	null: boolean;
	index: IndexChoice;
	autoIncrement: boolean;
	comment: string;
	/** '' | VIRTUAL | STORED | PERSISTENT */
	virtuality: string;
	expression: string;
}

let nextId = 1;

export function newColumn(overrides: Partial<ColumnDef> = {}): ColumnDef {
	return {
		id: nextId++,
		name: '',
		type: 'INT',
		length: '',
		defaultType: 'NONE',
		defaultValue: '',
		collation: '',
		attribute: '',
		null: false,
		index: '',
		autoIncrement: false,
		comment: '',
		virtuality: '',
		expression: '',
		...overrides
	};
}

// --- column spec (Table::generateFieldSpec) ---

const NO_LENGTH =
	/^(DATE|TINYBLOB|TINYTEXT|BLOB|TEXT|MEDIUMBLOB|MEDIUMTEXT|LONGBLOB|LONGTEXT|SERIAL|BOOLEAN|UUID|JSON)$/i;

/** Compatibility::isIntegersSupportLength */
function supportsLength(type: string, length: string, caps: ServerCaps): boolean {
	const lengthNotAllowed =
		['SMALLINT', 'MEDIUMINT', 'INT', 'BIGINT'].includes(type) ||
		(type === 'TINYINT' && length !== '1');
	return !(isIntegersLengthRestricted(caps) && lengthNotAllowed);
}

function userDefinedDefault(type: string, value: string, timestamp: boolean): string {
	if (timestamp && value === '0') return ' DEFAULT 0'; // a TIMESTAMP does not accept DEFAULT '0'
	if (timestamp && /^'\d\d\d\d-\d\d-\d\d \d\d:\d\d:\d\d(\.\d{1,6})?'$/.test(value)) {
		return ` DEFAULT ${value}`;
	}
	if (type === 'BIT') return ` DEFAULT b'${value.replace(/[^01]/g, '0')}'`;
	if (type === 'BOOLEAN') {
		// phpMyAdmin's regexes are unanchored; this is the intended behaviour
		if (/^(1|T|TRUE|YES)$/i.test(value)) return ' DEFAULT TRUE';
		if (/^(0|F|FALSE|NO)$/i.test(value)) return ' DEFAULT FALSE';
		return ` DEFAULT ${quoteStr(value)}`;
	}
	if (type === 'BINARY' || type === 'VARBINARY') return ` DEFAULT 0x${value}`;
	return ` DEFAULT ${quoteStr(value)}`;
}

/**
 * SQL for one column definition, e.g. "`id` INT UNSIGNED NOT NULL AUTO_INCREMENT".
 * Mirrors generateFieldSpec; the index (key) part is handled by `buildCreateTable`.
 */
export function buildColumnSpec(col: ColumnDef, caps: ServerCaps): string {
	const type = col.type;
	const length = col.length;
	const hasLength = length !== '';
	const timestamp = isTimestampLike(type);
	const virtuality = col.virtuality;
	const maria = isMariaDb(caps);
	const virtualOnMysql = virtuality !== '' && !maria;
	const virtualOnMaria = virtuality !== '' && maria;

	let q = `${quoteId(col.name.trimEnd())} ${type}`;

	if (hasLength && !NO_LENGTH.test(type) && supportsLength(type, length, caps)) {
		q += `(${length})`;
	}

	if (col.attribute !== '') {
		q += ` ${col.attribute}`;
		if (timestamp && /TIMESTAMP/i.test(col.attribute) && hasLength) q += `(${length})`;
	}

	if (col.collation !== '' && col.collation !== 'NULL' && hasCollation(type)) {
		const collation = virtualOnMaria ? col.collation.replace(/_.+/s, '') : col.collation;
		const [charset] = collation.split('_');
		q += ` CHARACTER SET ${charset}${charset === collation ? '' : ` COLLATE ${collation}`}`;
	}

	if (virtuality !== '') q += ` AS (${col.expression}) ${virtuality}`;

	if (virtuality === '' || virtualOnMysql) {
		q += col.null ? ' NULL' : ' NOT NULL';

		if (virtuality === '') {
			switch (col.defaultType) {
				case 'USER_DEFINED':
					q += userDefinedDefault(type, col.defaultValue, /TIMESTAMP/i.test(type));
					break;
				case 'NULL':
					// DEFAULT NULL on a NOT NULL column is ignored (as phpMyAdmin does)
					if (col.null) q += ' DEFAULT NULL';
					break;
				case 'CURRENT_TIMESTAMP':
					q += ' DEFAULT CURRENT_TIMESTAMP';
					if (hasLength && timestamp) q += `(${length})`;
					break;
				case 'UUID':
					q += ' DEFAULT uuid()';
					break;
				default:
					break;
			}
			if (col.autoIncrement) q += ' AUTO_INCREMENT';
		}
	}

	if (col.comment !== '') q += ` COMMENT ${quoteStr(col.comment)}`;
	return q;
}

// --- CREATE TABLE (CreateAddField::getTableCreationQuery) ---

export interface TableOptions {
	name: string;
	engine?: string;
	/** Table collation, e.g. utf8mb4_general_ci; the charset part is derived from it. */
	collation?: string;
	comment?: string;
}

/** Named columns only (phpMyAdmin skips columns with an empty name). */
export const namedColumns = (columns: ColumnDef[]): ColumnDef[] =>
	columns.filter((c) => c.name.length > 0);

/**
 * Key definitions of the columns: one PRIMARY KEY over all PRIMARY columns, then one INDEX /
 * UNIQUE / FULLTEXT / SPATIAL per column (the order phpMyAdmin uses). An AUTO_INCREMENT column
 * without any key gets a PRIMARY KEY when the table has none (needed by the server).
 */
export function buildKeyDefinitions(columns: ColumnDef[]): string[] {
	const cols = namedColumns(columns);
	const primary = cols.filter((c) => c.index === 'PRIMARY');
	const hasPrimary = primary.length > 0;
	const unkeyedAutoInc = cols.find((c) => c.autoIncrement && c.index === '' && c.virtuality === '');
	if (!hasPrimary && unkeyedAutoInc) primary.push(unkeyedAutoInc);

	const out: string[] = [];
	if (primary.length > 0) {
		out.push(`PRIMARY KEY (${primary.map((c) => quoteId(c.name.trimEnd())).join(', ')})`);
	}
	for (const kind of ['INDEX', 'UNIQUE', 'FULLTEXT', 'SPATIAL'] as const) {
		for (const c of cols.filter((x) => x.index === kind)) {
			out.push(`${kind} (${quoteId(c.name.trimEnd())})`);
		}
	}
	return out;
}

/** Full `CREATE TABLE` statement (multi-line, terminated by `;`). */
export function buildCreateTable(
	db: string,
	table: TableOptions,
	columns: ColumnDef[],
	caps: ServerCaps
): string {
	const defs = [
		...namedColumns(columns).map((c) => buildColumnSpec(c, caps)),
		...buildKeyDefinitions(columns)
	];
	let sql = `CREATE TABLE ${quoteId(db)}.${quoteId(table.name.trim())} (`;
	if (defs.length > 0) sql += '\n  ' + defs.join(',\n  ') + '\n';
	sql += ')';
	if (table.engine && table.engine !== 'Default') sql += ` ENGINE = ${table.engine}`;
	if (table.collation) {
		const [charset] = table.collation.split('_');
		sql += ` CHARSET=${charset}${charset === table.collation ? '' : ` COLLATE ${table.collation}`}`;
	}
	if (table.comment) sql += ` COMMENT = ${quoteStr(table.comment)}`;
	return sql + ';';
}

// --- ENUM / SET value lists ---

/** Parse `'a','b''c','d\'e'` into its values (quotes doubled or backslash-escaped). */
export function parseEnumValues(text: string): string[] {
	const out: string[] = [];
	let i = 0;
	const n = text.length;
	while (i < n) {
		while (i < n && /[\s,]/.test(text[i])) i++;
		if (i >= n) break;
		if (text[i] !== "'") {
			// tolerate unquoted values up to the next comma
			let j = text.indexOf(',', i);
			if (j === -1) j = n;
			out.push(text.slice(i, j).trim());
			i = j + 1;
			continue;
		}
		i++;
		let v = '';
		while (i < n) {
			const ch = text[i];
			if (ch === '\\' && i + 1 < n) {
				v += text[i + 1];
				i += 2;
			} else if (ch === "'" && text[i + 1] === "'") {
				v += "'";
				i += 2;
			} else if (ch === "'") {
				i++;
				break;
			} else {
				v += ch;
				i++;
			}
		}
		out.push(v);
	}
	return out;
}

/** Format values as `'a','b''c'` (single quotes doubled, backslashes escaped). */
export function formatEnumValues(values: string[]): string {
	return values.map((v) => `'${v.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`).join(',');
}
