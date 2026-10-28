/**
 * ALTER TABLE builders for columns: add, change, drop, move.
 *
 * Pure module (browser preview + server). Ported from phpMyAdmin 5.2.3:
 * CreateAddField::getColumnCreationQuery(), Structure/SaveController, DropColumnController and
 * Structure/MoveColumnsController.
 */
import {
	buildColumnSpec,
	buildKeyDefinitions,
	namedColumns,
	quoteId,
	type ColumnDef,
	type ServerCaps
} from './column-definition.ts';

export type ColumnPlacement =
	{ where: 'end' } | { where: 'first' } | { where: 'after'; after: string };

const tableRef = (db: string, table: string): string => `${quoteId(db)}.${quoteId(table)}`;
const head = (db: string, table: string): string => `ALTER TABLE ${tableRef(db, table)}`;

/**
 * `ALTER TABLE ... ADD col ..., ADD col2 ... AFTER col` plus the keys chosen in the Index column.
 * With FIRST / AFTER x the first new column takes that position and the others follow it.
 */
export function buildAddColumns(
	db: string,
	table: string,
	columns: ColumnDef[],
	caps: ServerCaps,
	placement: ColumnPlacement = { where: 'end' },
	opts: { tableHasPrimary?: boolean } = {}
): string {
	const cols = namedColumns(columns);
	const clauses = cols.map((c, i) => {
		let sql = `ADD ${buildColumnSpec(c, caps)}`;
		if (i > 0 && placement.where !== 'end') {
			sql += ` AFTER ${quoteId(cols[i - 1].name.trimEnd())}`;
		} else if (placement.where === 'first') sql += ' FIRST';
		else if (placement.where === 'after') sql += ` AFTER ${quoteId(placement.after)}`;
		return sql;
	});
	for (const key of buildKeyDefinitions(cols, opts)) clauses.push(`ADD ${key}`);
	return `${head(db, table)}\n  ${clauses.join(',\n  ')};`;
}

export interface ColumnChange {
	/** Current name of the column. */
	oldName: string;
	col: ColumnDef;
}

/** `ALTER TABLE ... CHANGE old new <spec>` for one or more columns. */
export function buildChangeColumns(
	db: string,
	table: string,
	changes: ColumnChange[],
	caps: ServerCaps
): string {
	const clauses = changes.map(
		(c) => `CHANGE ${quoteId(c.oldName)} ${buildColumnSpec(c.col, caps)}`
	);
	return `${head(db, table)}\n  ${clauses.join(',\n  ')};`;
}

export function buildDropColumns(db: string, table: string, names: string[]): string {
	return `${head(db, table)}\n  ${names.map((n) => `DROP ${quoteId(n)}`).join(',\n  ')};`;
}

/**
 * Reorder the columns: `MODIFY col <spec> FIRST|AFTER prev` for every column that is not already in
 * place (columns are processed in the new order, so each statement sees its predecessors in place).
 * `current` is the table's columns in their present order; `order` the wanted order of names.
 * Returns '' when nothing moves.
 */
export function buildMoveColumns(
	db: string,
	table: string,
	current: ColumnDef[],
	order: string[],
	caps: ServerCaps
): string {
	const byName = new Map(current.map((c) => [c.name, c]));
	const names = current.map((c) => c.name);
	const clauses: string[] = [];
	order.forEach((name, i) => {
		const def = byName.get(name);
		if (!def || names[i] === name) return;
		clauses.push(
			`MODIFY ${buildColumnSpec(def, caps)} ${i === 0 ? 'FIRST' : `AFTER ${quoteId(order[i - 1])}`}`
		);
		names.splice(names.indexOf(name), 1);
		names.splice(i, 0, name);
	});
	if (clauses.length === 0) return '';
	return `${head(db, table)}\n  ${clauses.join(',\n  ')};`;
}

/** Is `order` a permutation of the table's `current` column names? */
export function isPermutation(current: string[], order: string[]): boolean {
	if (current.length !== order.length) return false;
	const set = new Set(current);
	return order.every((n) => set.delete(n));
}
