/**
 * Insert / edit rows: column model, function lists and statement builder.
 *
 * Pure module (no server imports) shared by the form (types, functions, defaults) and the server
 * action (INSERT/UPDATE). Ported from phpMyAdmin 5.2.3: InsertEdit.php
 * (getCurrentValueForDifferentTypes, getCurrentValueAsAnArrayForMultipleEdit,
 * getQueryValuesForInsertAndUpdateInMultipleEdit, buildSqlQuery), Types.php (getTypeClass,
 * getFunctionsClass), Html\Generator::getDefaultFunctionForField and ReplaceController.
 *
 * Values are always bound as `?` parameters (strings, Buffers); only validated fragments
 * (function names, `b'01'` literals, `CURRENT_TIMESTAMP(n)`, digits) are inlined.
 */
import { quoteId } from './column-definition.ts';
import { N_ } from '#lib/i18n/translator.ts';

export type ValueKind =
	| 'int'
	| 'decimal'
	| 'float'
	| 'bit'
	| 'char'
	| 'text'
	| 'binary'
	| 'blob'
	| 'date'
	| 'datetime'
	| 'timestamp'
	| 'time'
	| 'year'
	| 'enum'
	| 'set'
	| 'json'
	| 'spatial'
	| 'uuid'
	| 'other';

export interface ColumnMeta {
	name: string;
	/** Full type as shown by SHOW COLUMNS, e.g. `int(10) unsigned`. */
	type: string;
	/** Lower-case type name without length/attributes, e.g. `int`. */
	trueType: string;
	kind: ValueKind;
	nullable: boolean;
	key: string;
	default: string | null;
	extra: string;
	comment: string;
	autoIncrement: boolean;
	/** VIRTUAL / STORED / PERSISTENT generated column: read-only. */
	generated: boolean;
	/** Default is an expression (MySQL `DEFAULT_GENERATED`) that cannot be prefilled as text. */
	defaultExpression: boolean;
	enumValues: string[];
	/** Declared length (`varchar(255)` -> 255, `bit(8)` -> 8), 0 when none. */
	length: number;
}

export interface ForeignOption {
	value: string;
	label: string;
}

/** `options` is null when the referenced table is too big for a dropdown (plain input + hint). */
export interface ForeignInfo {
	db: string;
	table: string;
	column: string;
	options: ForeignOption[] | null;
}

/** Column as sent to the form. */
export interface FormColumn extends ColumnMeta {
	protected: boolean;
	defaultFunction: string;
	foreign: ForeignInfo | null;
	/** Input transformation configured for the column (pma__column_info), if any. */
	inputTransform?: InputTransformInfo | null;
}

export interface InputTransformInfo {
	/** Plugin id (`text_plain_iptolong`). */
	id: string;
	widget: import('#lib/transformations/types.ts').InputWidget;
	language?: 'json' | 'sql' | 'xml';
	/** Parsed transformation options. */
	options: string[];
}

export interface InputSettings {
	charEditing: 'input' | 'textarea';
	textareaRows: number;
	textareaCols: number;
	charTextareaRows: number;
	charTextareaCols: number;
	longtextDoubleTextarea: boolean;
	limitChars: number;
}

// --- type classification ---------------------------------------------------------------------

export type TypeClass = 'CHAR' | 'NUMBER' | 'DATE' | 'SPATIAL' | 'JSON' | 'UUID' | '';

const NUMBER_TYPES = [
	'tinyint',
	'smallint',
	'mediumint',
	'int',
	'bigint',
	'decimal',
	'float',
	'double',
	'real',
	'bit',
	'boolean',
	'serial'
];
const DATE_TYPES = ['date', 'datetime', 'timestamp', 'time', 'year'];
const CHAR_TYPES = [
	'char',
	'varchar',
	'tinytext',
	'text',
	'mediumtext',
	'longtext',
	'binary',
	'varbinary',
	'tinyblob',
	'mediumblob',
	'blob',
	'longblob',
	'enum',
	'set',
	'inet6'
];
const SPATIAL_TYPES = [
	'geometry',
	'point',
	'linestring',
	'polygon',
	'multipoint',
	'multilinestring',
	'multipolygon',
	'geometrycollection'
];

/** Types::getTypeClass(). */
export function typeClass(trueType: string): TypeClass {
	const t = trueType.toLowerCase();
	if (NUMBER_TYPES.includes(t)) return 'NUMBER';
	if (DATE_TYPES.includes(t)) return 'DATE';
	if (CHAR_TYPES.includes(t)) return 'CHAR';
	if (SPATIAL_TYPES.includes(t)) return 'SPATIAL';
	if (t === 'json') return 'JSON';
	if (t === 'uuid') return 'UUID';
	return '';
}

export function kindOf(trueType: string): ValueKind {
	const t = trueType.toLowerCase();
	if (['tinyint', 'smallint', 'mediumint', 'int', 'bigint', 'serial', 'boolean'].includes(t))
		return 'int';
	if (['decimal', 'numeric', 'dec', 'fixed'].includes(t)) return 'decimal';
	if (['float', 'double', 'real'].includes(t)) return 'float';
	if (t === 'bit') return 'bit';
	if (['char', 'varchar'].includes(t)) return 'char';
	if (['tinytext', 'text', 'mediumtext', 'longtext'].includes(t)) return 'text';
	if (['binary', 'varbinary'].includes(t)) return 'binary';
	if (['tinyblob', 'blob', 'mediumblob', 'longblob'].includes(t)) return 'blob';
	if (['date', 'datetime', 'timestamp', 'time', 'year'].includes(t)) return t as ValueKind;
	if (t === 'enum' || t === 'set' || t === 'json' || t === 'uuid') return t;
	if (SPATIAL_TYPES.includes(t)) return 'spatial';
	return 'other';
}

/** Parse the quoted values of `enum('a','b''c')` / `set(...)`. */
export function parseEnumValues(type: string): string[] {
	const m = /^(?:enum|set)\((.*)\)/is.exec(type);
	if (!m) return [];
	const out: string[] = [];
	const re = /'((?:[^'\\]|''|\\.)*)'/gs;
	let x: RegExpExecArray | null;
	while ((x = re.exec(m[1])) !== null) {
		out.push(x[1].replace(/''/g, "'").replace(/\\(.)/gs, '$1'));
	}
	return out;
}

export interface ShowColumnsRow {
	field: string;
	type: string;
	null: boolean;
	key: string;
	default: string | null;
	extra: string;
	comment: string;
}

export function toColumnMeta(row: ShowColumnsRow): ColumnMeta {
	const trueType = row.type.replace(/(\(.*)|(\s.*)/s, '').toLowerCase();
	const lenMatch = /\((\d+)/.exec(row.type);
	const kind = kindOf(trueType);
	return {
		name: row.field,
		type: row.type,
		trueType,
		kind,
		nullable: row.null,
		key: row.key,
		default: row.default,
		extra: row.extra,
		comment: row.comment,
		autoIncrement: /auto_increment/i.test(row.extra),
		generated: /\b(VIRTUAL|STORED|PERSISTENT)\b/i.test(row.extra),
		defaultExpression: /DEFAULT_GENERATED/i.test(row.extra),
		enumValues: kind === 'enum' || kind === 'set' ? parseEnumValues(row.type) : [],
		length: lenMatch ? Number(lenMatch[1]) : 0
	};
}

// --- functions -------------------------------------------------------------------------------

export const FUNCTIONS: Record<'CHAR' | 'NUMBER' | 'DATE' | 'SPATIAL', string[]> = {
	CHAR: [
		'AES_DECRYPT',
		'AES_ENCRYPT',
		'BIN',
		'CHAR',
		'COMPRESS',
		'CURRENT_USER',
		'DATABASE',
		'DAYNAME',
		'DES_DECRYPT',
		'DES_ENCRYPT',
		'ENCRYPT',
		'FROM_BASE64',
		'HEX',
		'INET6_NTOA',
		'INET_NTOA',
		'LOAD_FILE',
		'LOWER',
		'LTRIM',
		'MD5',
		'MONTHNAME',
		'OLD_PASSWORD',
		'PASSWORD',
		'QUOTE',
		'REVERSE',
		'RTRIM',
		'SHA1',
		'SHA2',
		'SOUNDEX',
		'SPACE',
		'TO_BASE64',
		'TRIM',
		'UNCOMPRESS',
		'UNHEX',
		'UPPER',
		'USER',
		'UUID',
		'VERSION'
	],
	NUMBER: [
		'ABS',
		'ACOS',
		'ASCII',
		'ASIN',
		'ATAN',
		'BIT_LENGTH',
		'BIT_COUNT',
		'CEILING',
		'CHAR_LENGTH',
		'CONNECTION_ID',
		'COS',
		'COT',
		'CRC32',
		'DAYOFMONTH',
		'DAYOFWEEK',
		'DAYOFYEAR',
		'DEGREES',
		'EXP',
		'FLOOR',
		'HOUR',
		'INET6_ATON',
		'INET_ATON',
		'LENGTH',
		'LN',
		'LOG',
		'LOG2',
		'LOG10',
		'MICROSECOND',
		'MINUTE',
		'MONTH',
		'OCT',
		'ORD',
		'PI',
		'QUARTER',
		'RADIANS',
		'RAND',
		'ROUND',
		'SECOND',
		'SIGN',
		'SIN',
		'SQRT',
		'TAN',
		'TO_DAYS',
		'TO_SECONDS',
		'TIME_TO_SEC',
		'UNCOMPRESSED_LENGTH',
		'UNIX_TIMESTAMP',
		'UUID_SHORT',
		'WEEK',
		'WEEKDAY',
		'WEEKOFYEAR',
		'YEARWEEK'
	],
	DATE: [
		'CURDATE',
		'CURRENT_DATE',
		'CURRENT_TIME',
		'CURTIME',
		'DATE',
		'FROM_DAYS',
		'FROM_UNIXTIME',
		'LAST_DAY',
		'NOW',
		'SEC_TO_TIME',
		'SYSDATE',
		'TIME',
		'TIMESTAMP',
		'UTC_DATE',
		'UTC_TIME',
		'UTC_TIMESTAMP',
		'YEAR'
	],
	SPATIAL: [
		'ST_GeomFromText',
		'ST_GeomFromWKB',
		'ST_GeomCollFromText',
		'ST_LineFromText',
		'ST_MLineFromText',
		'ST_PointFromText',
		'ST_MPointFromText',
		'ST_PolyFromText',
		'ST_MPolyFromText',
		'ST_GeomCollFromWKB',
		'ST_LineFromWKB',
		'ST_MLineFromWKB',
		'ST_PointFromWKB',
		'ST_MPointFromWKB',
		'ST_PolyFromWKB',
		'ST_MPolyFromWKB'
	]
};

export const ALL_FUNCTIONS: string[] = [
	...FUNCTIONS.CHAR,
	...FUNCTIONS.NUMBER,
	...FUNCTIONS.DATE,
	...FUNCTIONS.SPATIAL
].sort();

const FUNCTION_SET = new Set(ALL_FUNCTIONS);

const FUNC_NO_PARAM = new Set([
	'CONNECTION_ID',
	'CURRENT_USER',
	'CURDATE',
	'CURTIME',
	'CURRENT_DATE',
	'CURRENT_TIME',
	'DATABASE',
	'LAST_INSERT_ID',
	'NOW',
	'PI',
	'RAND',
	'SYSDATE',
	'UNIX_TIMESTAMP',
	'USER',
	'UTC_DATE',
	'UTC_TIME',
	'UTC_TIMESTAMP',
	'UUID',
	'UUID_SHORT',
	'VERSION'
]);
const FUNC_OPTIONAL_PARAM = new Set(['NOW', 'RAND', 'UNIX_TIMESTAMP']);
const GIS_FROM = /^ST_[A-Za-z]+From(Text|WKB)$/;

/** Function groups for the select: the column's own class first, then the others. */
export function functionGroups(col: ColumnMeta): { label: string; functions: string[] }[] {
	const own = typeClass(col.trueType);
	const order = (['CHAR', 'NUMBER', 'DATE', 'SPATIAL'] as const).slice();
	if (own === 'CHAR' || own === 'NUMBER' || own === 'DATE' || own === 'SPATIAL') {
		order.splice(order.indexOf(own), 1);
		order.unshift(own);
	}
	const label = {
		CHAR: N_('String'),
		NUMBER: N_('Numeric'),
		DATE: N_('Date and time'),
		SPATIAL: N_('Spatial')
	} as const;
	return order.map((c) => ({ label: label[c], functions: [...FUNCTIONS[c]].sort() }));
}

export interface DefaultFunctionsConfig {
	[key: string]: string;
}

/** Html\Generator::getDefaultFunctionForField(). */
export function defaultFunction(
	col: ColumnMeta,
	opts: {
		insertMode: boolean;
		firstTimestamp: boolean;
		config: DefaultFunctionsConfig;
		hasForeign?: boolean;
	}
): string {
	if (col.trueType === 'uuid' || opts.hasForeign) return '';
	const cls = typeClass(col.trueType);
	let fn = cls && opts.config[`FUNC_${cls}`] !== undefined ? opts.config[`FUNC_${cls}`] : '';
	if (cls === 'SPATIAL' && fn !== '' && !/^ST_/i.test(fn)) fn = `ST_${fn}`;
	if (
		opts.insertMode &&
		col.trueType === 'timestamp' &&
		opts.firstTimestamp &&
		!col.default &&
		col.extra !== 'on update CURRENT_TIMESTAMP' &&
		!col.nullable
	) {
		fn = opts.config.first_timestamp ?? '';
	}
	if (opts.insertMode && col.key === 'PRI' && /^(var)?char\(36\)$/i.test(col.type)) {
		fn = opts.config.FUNC_UUID ?? '';
	}
	return fn;
}

// --- protected binary ------------------------------------------------------------------------

export type ProtectBinary = 'blob' | 'noblob' | 'all' | false;

/** Is the column shown as "binary - do not edit" (config ProtectBinary)? */
export function isProtected(col: ColumnMeta, protect: ProtectBinary): boolean {
	const isBlob = col.kind === 'blob';
	const isBinary = col.kind === 'binary';
	if (!isBlob && !isBinary) return false;
	return (protect === 'blob' && isBlob) || protect === 'all' || (protect === 'noblob' && !isBlob);
}

// --- form cell model -------------------------------------------------------------------------

export interface FormCell {
	value: string;
	/** Selected members of a SET column. */
	setValues: string[];
	isNull: boolean;
	func: string;
	salt: string;
	/** Value shown when the form was loaded (edit mode); undefined when inserting. */
	prev?: string;
	prevNull?: boolean;
}

/** Strip `b'..'` from a bit default. */
export function bitDefault(def: string): string {
	const m = /^b'([01]*)'$/i.exec(def);
	return m ? m[1] : def;
}

/** Prefilled cell of a blank row (InsertEdit::getSpecialCharsAndBackupFieldForInsertingMode). */
export function blankCell(col: ColumnMeta, opts: { func?: string; now?: Date } = {}): FormCell {
	let def = col.default;
	if (col.kind === 'datetime' && !col.nullable && def === null && opts.now) {
		def = opts.now.toISOString().slice(0, 19).replace('T', ' ');
	}
	const isNull = def === null && !col.autoIncrement && col.nullable;
	let value = def ?? '';
	if (col.defaultExpression && !/^current_timestamp/i.test(value)) value = '';
	if (col.kind === 'bit') value = bitDefault(value);
	if (col.kind === 'binary' && value !== '') value = hexOf(value);
	const set = col.kind === 'set' && value ? value.split(',') : [];
	return {
		value,
		setValues: set,
		isNull,
		func: opts.func ?? '',
		salt: ''
	};
}

function hexOf(s: string): string {
	return Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('');
}

// --- statement building ----------------------------------------------------------------------

export interface CellInput {
	column: ColumnMeta;
	cell: FormCell;
	/** Uploaded file content. */
	upload?: Uint8Array | null;
	/** `protected` binary column: left alone on update, nothing sent on insert. */
	isProtected?: boolean;
	/** Current content of a protected column of the source row, used when inserting as new. */
	protectedOriginal?: Uint8Array | null;
}

export interface Statement {
	sql: string;
	params: (string | Uint8Array | number)[];
}

export class InsertEditError extends Error {}

interface Piece {
	/** SQL expression with `?` placeholders. */
	expr: string;
	params: Statement['params'];
}

const SQL_NULL: Piece = { expr: 'NULL', params: [] };
const SQL_EMPTY: Piece = { expr: '?', params: [''] };

function validateFunction(fn: string): void {
	if (!FUNCTION_SET.has(fn)) throw new InsertEditError(`Unknown function: ${fn}`);
}

/** InsertEdit::getCurrentValueAsAnArrayForMultipleEdit(). */
function functionPiece(fn: string, input: CellInput): Piece {
	validateFunction(fn);
	const { cell } = input;
	const value = input.upload ? input.upload : cell.value;
	const strValue = typeof value === 'string' ? value : '';
	if (GIS_FROM.test(fn)) {
		const m = /^(['"]?)(.*?)\1(?:,(\d+))?$/s.exec(strValue);
		const text = m ? m[2] : strValue;
		const srid = m?.[3];
		return { expr: `${fn}(?${srid ? `, ${Number(srid)}` : ''})`, params: [text] };
	}
	const noParam = FUNC_NO_PARAM.has(fn);
	if (!noParam || (strValue !== '' && FUNC_OPTIONAL_PARAM.has(fn))) {
		if (
			fn === 'AES_ENCRYPT' ||
			fn === 'AES_DECRYPT' ||
			(cell.salt !== '' && (fn === 'DES_ENCRYPT' || fn === 'DES_DECRYPT' || fn === 'ENCRYPT'))
		) {
			return { expr: `${fn}(?, ?)`, params: [value, cell.salt] };
		}
		if (fn === 'NOW' && /^[0-6]$/.test(strValue)) return { expr: `NOW(${strValue})`, params: [] };
		return { expr: `${fn}(?)`, params: [value] };
	}
	return { expr: `${fn}()`, params: [] };
}

const CURRENT_TS = /^current_timestamp(\(([0-6]?)\))?$/i;

/**
 * InsertEdit::getCurrentValueForDifferentTypes() for a column without function. Returns the piece
 * and whether it is the "empty" literal (`''`), or null when nothing must be sent (protected).
 */
function plainPiece(input: CellInput, isInsert: boolean): { piece: Piece | null; empty: boolean } {
	const { column, cell } = input;
	if (input.upload) return { piece: { expr: '?', params: [input.upload] }, empty: false };
	if (input.isProtected) {
		if (isInsert && input.protectedOriginal && input.protectedOriginal.length > 0) {
			return { piece: { expr: '?', params: [input.protectedOriginal] }, empty: false };
		}
		return { piece: null, empty: true };
	}
	if (column.kind === 'set') {
		const joined = cell.setValues.join(',');
		return {
			piece: joined === '' ? SQL_EMPTY : { expr: '?', params: [joined] },
			empty: joined === ''
		};
	}
	const v = cell.value;
	if (v === '') {
		if (column.autoIncrement) return { piece: SQL_NULL, empty: true };
		if (column.kind === 'uuid' && !cell.isNull)
			return { piece: { expr: 'UUID()', params: [] }, empty: false };
		return { piece: SQL_EMPTY, empty: true };
	}
	if (column.kind === 'binary' || column.kind === 'blob') {
		const hex = v.replace(/^0x/i, '');
		if (!/^([0-9a-f]{2})*$/i.test(hex)) {
			throw new InsertEditError(`Column ${column.name}: invalid hexadecimal value.`);
		}
		return { piece: { expr: '?', params: [Buffer.from(hex, 'hex')] }, empty: false };
	}
	if (column.kind === 'bit') {
		return { piece: { expr: `b'${v.replace(/[^01]/g, '0')}'`, params: [] }, empty: false };
	}
	if (column.kind === 'uuid' && v.toLowerCase() === 'uuid()') {
		return { piece: { expr: 'UUID()', params: [] }, empty: false };
	}
	if (column.kind === 'datetime' || column.kind === 'timestamp' || column.kind === 'date') {
		const m = CURRENT_TS.exec(v.trim());
		if (m)
			return {
				piece: { expr: `CURRENT_TIMESTAMP${m[1] ? `(${m[2]})` : ''}`, params: [] },
				empty: false
			};
	}
	return { piece: { expr: '?', params: [v] }, empty: false };
}

/** The value piece of a cell, or null to omit / leave the column alone. */
function valuePiece(input: CellInput, isInsert: boolean): Piece | null {
	const { column, cell } = input;
	if (cell.func && !input.isProtected) {
		if (cell.isNull && cell.value === '' && !input.upload) return SQL_NULL;
		return functionPiece(cell.func, input);
	}
	const { piece, empty } = plainPiece(input, isInsert);
	if (piece === null) return null;
	if (cell.isNull && empty) return SQL_NULL;
	if (isInsert && empty && column.defaultExpression && !cell.isNull && !column.autoIncrement) {
		return { expr: 'DEFAULT', params: [] };
	}
	return piece;
}

/** Row input for a statement. */
export type RowCells = CellInput[];

/**
 * INSERT (multi-row). Generated columns are skipped, columns no row sets are omitted
 * (`DEFAULT` fills the gaps). Returns null when no row has anything to insert.
 */
export function buildInsert(
	db: string,
	table: string,
	rows: RowCells[],
	opts: { ignore?: boolean } = {}
): Statement | null {
	const pieces = rows.map((cells) =>
		cells
			.filter((c) => !c.column.generated)
			.map((c) => ({ name: c.column.name, p: valuePiece(c, true) }))
	);
	const names: string[] = [];
	for (const row of pieces) {
		for (const c of row) if (c.p && !names.includes(c.name)) names.push(c.name);
	}
	if (rows.length === 0) return null;
	if (names.length === 0) {
		return {
			sql: `INSERT ${opts.ignore ? 'IGNORE ' : ''}INTO ${quoteId(db)}.${quoteId(table)} () VALUES ()`,
			params: []
		};
	}
	const params: Statement['params'] = [];
	const tuples = pieces.map((row) => {
		const exprs = names.map((n) => {
			const c = row.find((x) => x.name === n);
			if (!c?.p) return 'DEFAULT';
			params.push(...c.p.params);
			return c.p.expr;
		});
		return `(${exprs.join(', ')})`;
	});
	return {
		sql:
			`INSERT ${opts.ignore ? 'IGNORE ' : ''}INTO ${quoteId(db)}.${quoteId(table)} ` +
			`(${names.map(quoteId).join(', ')}) VALUES ${tuples.join(', ')}`,
		params
	};
}

/**
 * UPDATE of one row, only changed columns (InsertEdit::getQueryValuesForInsertAndUpdateInMultipleEdit).
 * `where` must be a verified clause. Returns null when nothing changed.
 */
export function buildUpdate(
	db: string,
	table: string,
	cells: RowCells,
	where: string,
	opts: { clauseIsUnique?: boolean } = {}
): Statement | null {
	const sets: string[] = [];
	const params: Statement['params'] = [];
	for (const input of cells) {
		const { column, cell } = input;
		if (column.generated) continue;
		const prevNull = cell.prevNull === true;
		const piece = valuePiece(input, false);
		if (piece === null) continue;
		let include: boolean;
		if (prevNull && !cell.isNull) {
			include = true;
		} else {
			const unchanged =
				!cell.func &&
				!cell.isNull &&
				!input.upload &&
				cell.prev !== undefined &&
				currentText(input) === cell.prev;
			include = !unchanged && !(prevNull && cell.isNull);
		}
		if (!include) continue;
		sets.push(`${quoteId(column.name)} = ${piece.expr}`);
		params.push(...piece.params);
	}
	if (sets.length === 0) return null;
	return {
		sql:
			`UPDATE ${quoteId(db)}.${quoteId(table)} SET ${sets.join(', ')} WHERE ${where}` +
			(opts.clauseIsUnique ? '' : ' LIMIT 1'),
		params
	};
}

/** The text the form would have shown for this cell, to compare with `prev`. */
function currentText(input: CellInput): string {
	return input.column.kind === 'set' ? input.cell.setValues.join(',') : input.cell.value;
}

// --- rendering -------------------------------------------------------------------------------

const ESC: Record<string, string> = {
	'\0': '\\0',
	'\n': '\\n',
	'\r': '\\r',
	'\\': '\\\\',
	"'": "\\'",
	'"': '\\"',
	'\x1a': '\\Z'
};

function literal(v: Statement['params'][number]): string {
	if (typeof v === 'number') return String(v);
	if (typeof v === 'string') {
		// eslint-disable-next-line no-control-regex
		return `'${v.replace(/[\0\n\r\\'"\x1a]/g, (c) => ESC[c])}'`;
	}
	return `0x${Array.from(v, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

/** Statement with its parameters inlined, for display ("Show insert query") only. */
export function renderStatement(st: Statement): string {
	let i = 0;
	let out = '';
	let quote: string | null = null;
	for (const ch of st.sql) {
		if (quote) {
			if (ch === quote) quote = null;
			out += ch;
		} else if (ch === '`' || ch === "'") {
			quote = ch;
			out += ch;
		} else if (ch === '?' && i < st.params.length) {
			out += literal(st.params[i++]);
		} else {
			out += ch;
		}
	}
	return out;
}

/** Validation message for a JSON column value that would be rejected by the server, else null. */
export function jsonError(col: ColumnMeta, cell: FormCell): string | null {
	if (col.kind !== 'json' || cell.isNull || cell.func || cell.value.trim() === '') return null;
	try {
		JSON.parse(cell.value);
		return null;
	} catch (e) {
		return e instanceof Error ? e.message : 'Invalid JSON';
	}
}
