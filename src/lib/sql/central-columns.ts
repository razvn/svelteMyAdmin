/**
 * Central list of columns (`pma__central_columns`): row encoding shared by the server and the UI.
 * Ported from libraries/classes/Database/CentralColumns.php (getInsertQuery, handleColumnExtra).
 *
 * Encoding of a stored row: `col_type` is the lower-case base type (`varchar`), `col_length` the text
 * between the brackets (`10,2` / `'a','b'`), `col_isNull` 0/1, `col_default` '' for "no default" and
 * `col_extra` is `"<extra>,<attribute>"` (e.g. `auto_increment,UNSIGNED`, or just `,`).
 */
import { newColumn, type ColumnDef, type DefaultType } from './column-definition.ts';

export interface CentralColumn {
	name: string;
	/** Lower-case base type, e.g. `int`. */
	type: string;
	length: string;
	collation: string;
	isNull: boolean;
	/** `auto_increment` or ''. */
	extra: string;
	/** '' | BINARY | UNSIGNED | UNSIGNED ZEROFILL | on update CURRENT_TIMESTAMP */
	attribute: string;
	/** '' = none, 'NULL', 'CURRENT_TIMESTAMP' or a literal. */
	default: string;
}

/** A row of the storage table as read from MySQL. */
export interface CentralRow {
	col_name: string;
	col_type: string;
	col_length: string | null;
	col_collation: string;
	col_isNull: number | string | boolean;
	col_extra: string | null;
	col_default: string | null;
}

/** Util::extractColumnSpec: `int(10) unsigned zerofill` => type, brackets, attribute. */
export function extractColumnSpec(columnType: string): {
	type: string;
	length: string;
	attribute: string;
} {
	const m = /^(\w+)\s*(?:\((.*)\))?\s*(.*)$/s.exec(columnType.trim());
	if (!m) return { type: columnType, length: '', attribute: '' };
	const rest = m[3].toLowerCase();
	let attribute = '';
	if (rest.includes('unsigned') && rest.includes('zerofill')) attribute = 'UNSIGNED ZEROFILL';
	else if (rest.includes('unsigned')) attribute = 'UNSIGNED';
	else if (rest.includes('zerofill')) attribute = 'UNSIGNED ZEROFILL';
	else if (rest.includes('binary')) attribute = 'BINARY';
	return { type: m[1].toLowerCase(), length: m[2] ?? '', attribute };
}

/** The `col_extra` value: `<extra>,<attribute>`. */
export const encodeExtra = (extra: string, attribute: string): string => `${extra},${attribute}`;

/** CentralColumns::handleColumnExtra. */
export function decodeExtra(stored: string | null): { extra: string; attribute: string } {
	const vals = (stored ?? '').split(',');
	let attribute = '';
	if (vals.includes('BINARY')) attribute = 'BINARY';
	else if (vals.includes('UNSIGNED')) attribute = 'UNSIGNED';
	else if (vals.includes('UNSIGNED ZEROFILL')) attribute = 'UNSIGNED ZEROFILL';
	else if (vals.includes('on update CURRENT_TIMESTAMP')) attribute = 'on update CURRENT_TIMESTAMP';
	return { extra: vals.includes('auto_increment') ? 'auto_increment' : '', attribute };
}

export function fromRow(row: CentralRow): CentralColumn {
	const { extra, attribute } = decodeExtra(row.col_extra);
	return {
		name: row.col_name,
		type: row.col_type,
		length: row.col_length ?? '',
		collation: row.col_collation,
		isNull: Number(row.col_isNull) === 1 || row.col_isNull === true,
		extra,
		attribute,
		default: row.col_default ?? ''
	};
}

/** Values of the storage row for a column: col_name .. col_default (everything after `db_name`). */
export function toRowValues(c: CentralColumn): (string | number)[] {
	return [
		c.name,
		c.type,
		c.length,
		c.collation,
		c.isNull ? 1 : 0,
		encodeExtra(c.extra, c.attribute),
		c.default
	];
}

/** A `SHOW FULL COLUMNS` row => central column (CentralColumns::getInsertQuery). */
export function fromShowColumn(c: {
	field: string;
	type: string;
	collation: string | null;
	null: boolean;
	extra: string;
	default: string | null;
}): CentralColumn {
	const spec = extractColumnSpec(c.type);
	return {
		name: c.field,
		type: spec.type,
		length: spec.length,
		collation: c.collation ?? '',
		isNull: c.null,
		extra: c.extra,
		attribute: spec.attribute,
		default: c.default ?? ''
	};
}

const CURRENT_TS = /^(CURRENT_TIMESTAMP|current_timestamp\(\))$/;

export function defaultKind(def: string): { type: DefaultType; value: string } {
	if (def === '') return { type: 'NONE', value: '' };
	if (CURRENT_TS.test(def)) return { type: 'CURRENT_TIMESTAMP', value: '' };
	if (def === 'NULL') return { type: 'NULL', value: '' };
	return { type: 'USER_DEFINED', value: def };
}

/** Central column => column editor definition. */
export function toColumnDef(c: CentralColumn): ColumnDef {
	const d = defaultKind(c.default);
	return newColumn({
		name: c.name,
		type: c.type.toUpperCase(),
		length: c.length,
		collation: c.collation,
		attribute: c.attribute,
		null: c.isNull,
		autoIncrement: c.extra === 'auto_increment',
		defaultType: d.type,
		defaultValue: d.value
	});
}

/** Column editor definition => central column. */
export function fromColumnDef(col: ColumnDef): CentralColumn {
	let def = '';
	if (col.defaultType === 'USER_DEFINED') def = col.defaultValue;
	else if (col.defaultType === 'CURRENT_TIMESTAMP') def = 'CURRENT_TIMESTAMP';
	else if (col.defaultType === 'NULL') def = 'NULL';
	return {
		name: col.name.trim(),
		type: col.type.toLowerCase(),
		length: col.length,
		collation: col.collation,
		isNull: col.null,
		extra: col.autoIncrement ? 'auto_increment' : '',
		attribute: col.attribute,
		default: def
	};
}
