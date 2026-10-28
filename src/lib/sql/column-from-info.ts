/**
 * Rebuild the editable column model (`ColumnDef`) from an `information_schema.COLUMNS` row, so that
 * Change / Move columns re-emit the same definition the server reports.
 * Mirrors what Table::getColumnsMeta / Structure\ChangeController feed into the column form.
 */
import {
	isMariaDb,
	newColumn,
	supportsStoredKeyword,
	type ColumnDef,
	type DefaultType,
	type ServerCaps
} from './column-definition.ts';

export interface InfoColumnRow {
	name: string;
	/** COLUMN_TYPE, e.g. `int(10) unsigned`, `enum('a','b')`. */
	columnType: string;
	nullable: boolean;
	columnDefault: string | null;
	extra: string;
	collation: string | null;
	comment: string;
	generationExpression: string | null;
}

const hex = (value: string): string =>
	[...new TextEncoder().encode(value)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** MariaDB reports string defaults as SQL literals: `'it\'s'` / `'it''s'`. */
function unquoteLiteral(value: string): string {
	return value
		.slice(1, -1)
		.replace(/\\(.)|''/gs, (m, c: string | undefined) => (c === undefined ? "'" : c));
}

function parseDefault(
	row: InfoColumnRow,
	type: string,
	caps: ServerCaps
): { defaultType: DefaultType; defaultValue: string } {
	const none = { defaultType: 'NONE' as const, defaultValue: '' };
	const raw = row.columnDefault;
	if (raw === null) return none;
	const maria = isMariaDb(caps);
	if (/^current_timestamp(\(\d*\))?$/i.test(raw)) {
		return { defaultType: 'CURRENT_TIMESTAMP', defaultValue: '' };
	}
	if (/^uuid\(\)$/i.test(raw) || /^\(uuid\(\)\)$/i.test(raw)) {
		return { defaultType: 'UUID', defaultValue: '' };
	}
	if (maria) {
		if (raw.toUpperCase() === 'NULL') {
			return row.nullable ? { defaultType: 'NULL', defaultValue: '' } : none;
		}
		let value = raw.startsWith("'") && raw.endsWith("'") ? unquoteLiteral(raw) : raw;
		const bit = value.match(/^b'([01]*)'$/);
		if (bit) value = bit[1];
		return finishUserDefined(type, value);
	}
	const bit = raw.match(/^b'([01]*)'$/);
	return finishUserDefined(type, bit ? bit[1] : raw);
}

function finishUserDefined(type: string, value: string) {
	if (type === 'BINARY' || type === 'VARBINARY') {
		return { defaultType: 'USER_DEFINED' as const, defaultValue: hex(value) };
	}
	return { defaultType: 'USER_DEFINED' as const, defaultValue: value };
}

export function columnFromInfo(row: InfoColumnRow, caps: ServerCaps, id?: number): ColumnDef {
	const m = row.columnType.match(/^([a-z0-9_]+)(?:\((.*)\))?\s*(.*)$/is);
	const type = (m?.[1] ?? row.columnType).toUpperCase();
	let length = m?.[2] ?? '';
	const rest = (m?.[3] ?? '').toLowerCase();

	let attribute = '';
	if (/\bzerofill\b/.test(rest)) attribute = 'UNSIGNED ZEROFILL';
	else if (/\bunsigned\b/.test(rest)) attribute = 'UNSIGNED';
	const extra = row.extra.toLowerCase();
	if (/on update current_timestamp/.test(extra)) attribute = 'on update CURRENT_TIMESTAMP';

	let virtuality = '';
	if (/\bvirtual generated\b/.test(extra)) virtuality = 'VIRTUAL';
	else if (/\b(stored|persistent) generated\b/.test(extra)) {
		virtuality = supportsStoredKeyword(caps) ? 'STORED' : 'PERSISTENT';
	}
	if (/^(ENUM|SET)$/.test(type)) length = m?.[2] ?? '';

	const def = virtuality
		? { defaultType: 'NONE' as DefaultType, defaultValue: '' }
		: parseDefault(row, type, caps);

	return newColumn({
		...(id === undefined ? {} : { id }),
		name: row.name,
		type,
		length,
		...def,
		collation: row.collation ?? '',
		attribute,
		null: row.nullable,
		autoIncrement: /auto_increment/.test(extra),
		comment: row.comment,
		virtuality,
		expression: virtuality ? (row.generationExpression ?? '').replaceAll("\\'", "'") : ''
	});
}
