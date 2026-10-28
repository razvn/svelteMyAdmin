/** Header-click sorting (client-safe). Server side building of ORDER BY: server/table/order-by.ts. */
import type { ColumnKind } from './column-kind.ts';

export type SortDir = 'asc' | 'desc';
export interface Sort {
	column: string;
	dir: SortDir;
}
/** Config `Order`. */
export type OrderConfig = 'ASC' | 'DESC' | 'SMART';

/** First direction when a column is clicked: SMART sorts temporal columns newest first. */
export function firstDirection(order: OrderConfig, kind: ColumnKind): SortDir {
	if (order === 'ASC') return 'asc';
	if (order === 'DESC') return 'desc';
	return kind === 'temporal' ? 'desc' : 'asc';
}

/** Header click cycle: none -> first -> opposite -> none. Another column starts over. */
export function nextSort(
	current: Sort | null,
	column: string,
	kind: ColumnKind,
	order: OrderConfig
): Sort | null {
	const first = firstDirection(order, kind);
	if (!current || current.column !== column) return { column, dir: first };
	if (current.dir === first) return { column, dir: first === 'asc' ? 'desc' : 'asc' };
	return null;
}
