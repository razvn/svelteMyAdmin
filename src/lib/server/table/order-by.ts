import type { Sort } from '#lib/table/sort.ts';
import { escapeId } from '#lib/server/db/escape.ts';

/**
 * `ORDER BY` clause from user supplied sort keys. Column names are only accepted when they exist in
 * `columns`; unknown ones are dropped. Returns '' when nothing remains.
 */
export function buildOrderBy(sorts: Sort[], columns: string[]): string {
	const valid = new Set(columns);
	const parts = sorts
		.filter((s) => valid.has(s.column))
		.map((s) => `${escapeId(s.column)} ${s.dir === 'desc' ? 'DESC' : 'ASC'}`);
	return parts.length ? `ORDER BY ${parts.join(', ')}` : '';
}

/** Validate a sort request (`?sort=col&dir=desc`) against the table columns. */
export function parseSort(
	column: string | null,
	dir: string | null,
	columns: string[]
): Sort | null {
	if (!column || !columns.includes(column)) return null;
	return { column, dir: dir?.toLowerCase() === 'desc' ? 'desc' : 'asc' };
}

/** pma__table_uiprefs `sorted_col`: "`table`.`col` DESC". */
export function formatSortedCol(table: string, sort: Sort): string {
	return `${escapeId(table)}.${escapeId(sort.column)} ${sort.dir === 'desc' ? 'DESC' : 'ASC'}`;
}

export function parseSortedCol(value: unknown, columns: string[]): Sort | null {
	if (typeof value !== 'string') return null;
	const m = value.match(/^`(?:[^`]|``)+`\.`((?:[^`]|``)+)` (ASC|DESC)$/);
	if (!m) return null;
	return parseSort(m[1].replaceAll('``', '`'), m[2], columns);
}
