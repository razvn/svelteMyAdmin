/**
 * Minimal "unique condition" for a fetched row, used by zoom search to link a plotted point to
 * the edit form.
 *
 * TODO: switch to the shared `unique-condition.ts` (Util::getUniqueCondition port) once it is
 * merged; this simple version only covers primary keys and falls back to every non-binary column.
 */
import type { ColumnInfo } from '#lib/server/db/dbi.ts';
import { escapeId, quoteValue, type SqlValue } from '#lib/server/db/escape.ts';
import { baseColumnType, getTypeClass } from '#lib/sql/table-operators.ts';

const NUMBER_RE = /^-?\d+(\.\d+)?$/;

function literal(column: ColumnInfo, value: unknown): string {
	if (value === null || value === undefined) return 'IS NULL';
	if (typeof value === 'number' || typeof value === 'bigint') return `= ${value}`;
	if (
		typeof value === 'string' &&
		getTypeClass(baseColumnType(column.type)) === 'NUMBER' &&
		NUMBER_RE.test(value)
	) {
		return `= ${value}`;
	}
	return `= ${quoteValue(value as SqlValue)}`;
}

function isBlobLike(column: ColumnInfo): boolean {
	return /blob|binary|geometry|point|polygon|linestring|json|text/i.test(column.type);
}

/** `` `id` = 5 AND `k` = 'a' ``; '' when no usable column exists. */
export function simpleUniqueCondition(columns: ColumnInfo[], row: Record<string, unknown>): string {
	const pk = columns.filter((c) => c.key === 'PRI');
	const used = pk.length > 0 ? pk : columns.filter((c) => !isBlobLike(c));
	return used.map((c) => `${escapeId(c.field)} ${literal(c, row[c.field])}`).join(' AND ');
}
