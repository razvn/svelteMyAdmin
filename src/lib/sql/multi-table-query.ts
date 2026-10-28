/**
 * Multi-table query builder, a port of phpMyAdmin's js/src/database/query_generator.js and the
 * "Update query" handler of multi_table_query.js.
 *
 * Differences from the JS (bug fixes): the `AS` alias of a joined table uses that table's own alias
 * and ON references use each table's alias; composite foreign keys join on all their columns;
 * identifiers from foreign keys are escaped; tables are ordered so that related ones follow each other; BETWEEN accepts `a AND b`; ORDER BY is supported
 * (the radio buttons exist in phpMyAdmin but are never read).
 */
import { escapeId } from './escape.ts';
import type { QuerySchemaData } from './query-schema.ts';

export const MTQ_OPERATORS = [
	'=',
	'>',
	'>=',
	'<',
	'<=',
	'!=',
	'LIKE',
	'LIKE %...%',
	'NOT LIKE',
	'NOT LIKE %...%',
	'IN (...)',
	'NOT IN (...)',
	'BETWEEN',
	'NOT BETWEEN',
	'IS NULL',
	'IS NOT NULL',
	'REGEXP',
	'REGEXP ^...$',
	'NOT REGEXP'
] as const;

export const MTQ_HINTS: Record<string, string> = {
	'IN (...)': 'Separate the values by commas',
	'NOT IN (...)': 'Separate the values by commas'
};

export const isOpWithoutArg = (op: string) => op === 'IS NULL' || op === 'IS NOT NULL';

export interface MtqColumn {
	/** Table name; empty when the card is not configured. */
	table: string;
	/** Column name or `*`. */
	column: string;
	show: boolean;
	tableAlias: string;
	columnAlias: string;
	sort: '' | 'ASC' | 'DESC';
	useCriteria: boolean;
	logicalOp: 'AND' | 'OR';
	/** Column the criterion applies to (same table as `table`). */
	criteriaColumn: string;
	op: string;
	rhs: 'text' | 'anotherColumn';
	rhsText: string;
	rhsTable: string;
	rhsColumn: string;
}

export function emptyMtqColumn(): MtqColumn {
	return {
		table: '',
		column: '',
		show: true,
		tableAlias: '',
		columnAlias: '',
		sort: '',
		useCriteria: false,
		logicalOp: 'AND',
		criteriaColumn: '',
		op: '=',
		rhs: 'text',
		rhsText: '',
		rhsTable: '',
		rhsColumn: ''
	};
}

export interface MtqForeignKey {
	constraint?: string;
	table: string;
	column: string;
	refTable: string;
	refColumn: string;
}

/** Foreign keys + internal relations of the schema in the shape the builder needs. */
export function foreignKeysFromSchema(data: QuerySchemaData): MtqForeignKey[] {
	return [
		...data.foreignKeys.map((k) => ({ ...k })),
		...data.internalRelations.map((r) => ({
			constraint: `internal:${r.table}.${r.field}`,
			table: r.table,
			column: r.field,
			refTable: r.refTable,
			refColumn: r.refField
		}))
	];
}

const escapeSingleQuote = (s: string) => s.replaceAll('\\', '\\\\').replaceAll("'", "\\'");

const ref = (table: string, column: string) =>
	`${escapeId(table)}.${column === '*' ? '*' : escapeId(column)}`;

const effectiveTable = (c: MtqColumn) => (c.tableAlias !== '' ? c.tableAlias : c.table);

function formatCondition(op: string, text: string): string {
	const q = escapeSingleQuote(text);
	switch (op) {
		case 'LIKE %...%':
			return ` LIKE '%${q}%'`;
		case 'NOT LIKE %...%':
			return ` NOT LIKE '%${q}%'`;
		case 'IN (...)':
			return ` IN (${text})`;
		case 'NOT IN (...)':
			return ` NOT IN (${text})`;
		case 'REGEXP ^...$':
			return ` REGEXP '^${q}$'`;
		case 'BETWEEN':
		case 'NOT BETWEEN': {
			const parts = text.split(/\s+and\s+/i);
			if (parts.length === 2) {
				return ` ${op} '${escapeSingleQuote(parts[0])}' AND '${escapeSingleQuote(parts[1])}'`;
			}
			return ` ${op} '${q}'`;
		}
		default:
			return ` ${op} '${q}'`;
	}
}

/** Plain comparison operator for "another column" criteria. */
function plainOp(op: string): string {
	return op
		.replace(/ %\.\.\.%$/, '')
		.replace(/ \^\.\.\.\$$/, '')
		.replace(/ \(\.\.\.\)$/, '');
}

export function conditionOf(c: MtqColumn): string | null {
	if (c.criteriaColumn === '') return null;
	let q = ref(effectiveTable(c), c.criteriaColumn);
	if (isOpWithoutArg(c.op)) return q + ' ' + c.op;
	if (c.rhs === 'text') return q + formatCondition(c.op, c.rhsText);
	if (c.rhsTable === '' || c.rhsColumn === '') return null;
	q += ' ' + plainOp(c.op) + ' ' + ref(c.rhsTable, c.rhsColumn);
	return q;
}

function generateJoin(
	newTable: string,
	aliases: Map<string, string[]>,
	keys: MtqForeignKey[]
): string {
	const first = (t: string) => aliases.get(t)?.[0] ?? '';
	const name = (t: string) => (first(t) !== '' ? first(t) : t);
	let q = ' \n\tLEFT JOIN ' + escapeId(newTable);
	if (first(newTable) !== '') q += ' AS ' + escapeId(first(newTable));
	q +=
		' ON ' +
		keys
			.map(
				(key) =>
					`${escapeId(name(key.table))}.${escapeId(key.column)} = ${escapeId(name(key.refTable))}.${escapeId(key.refColumn)}`
			)
			.join(' AND ');
	return q;
}

export function generateFromBlock(
	aliases: Map<string, string[]>,
	foreignKeys: MtqForeignKey[]
): string {
	const tables = [...aliases.keys()];
	const fks = foreignKeys.filter((k) => tables.includes(k.table) && tables.includes(k.refTable));
	const used: string[] = [];
	let query = '';
	const related = (table: string, k: MtqForeignKey) =>
		(k.table === table && used.includes(k.refTable)) ||
		(k.refTable === table && used.includes(k.table));
	const remaining = [...tables];
	while (remaining.length > 0) {
		// Take the next table that can join the ones already used (phpMyAdmin simply iterates in
		// selection order and loses the join when a bridging table comes later), else the next one.
		let at = used.length === 0 ? -1 : remaining.findIndex((t) => fks.some((k) => related(t, k)));
		if (at < 0) at = 0;
		const [table] = remaining.splice(at, 1);
		let join = '';
		const hit = fks.find((k) => related(table, k));
		if (hit) {
			// all columns of the same (composite) constraint
			const group =
				hit.constraint !== undefined
					? fks.filter(
							(k) =>
								k.constraint === hit.constraint &&
								k.table === hit.table &&
								k.refTable === hit.refTable
						)
					: [hit];
			join = generateJoin(table, aliases, group);
		}
		if (join !== '') {
			query += join;
		} else {
			if (used.length > 0) query += '\n\t, ';
			query += escapeId(table);
			const alias = aliases.get(table)?.[0] ?? '';
			if (alias !== '') query += ' AS ' + escapeId(alias);
		}
		used.push(table);
	}
	return query;
}

export type MtqResult = { ok: true; sql: string } | { ok: false; error: string };

export function buildMultiTableQuery(
	columns: MtqColumn[],
	foreignKeys: MtqForeignKey[]
): MtqResult {
	const shown = columns.filter((c) => c.table !== '' && c.column !== '' && c.show);
	if (shown.length === 0) return { ok: false, error: 'Nothing selected' };

	const aliases = new Map<string, string[]>();
	for (const c of shown) {
		const list = aliases.get(c.table);
		if (!list) aliases.set(c.table, [c.tableAlias]);
		else if (!list.includes(c.tableAlias)) list.push(c.tableAlias);
	}

	const select = shown.map((c) => {
		let s = ref(effectiveTable(c), c.column);
		if (c.columnAlias !== '' && c.column !== '*') s += ' AS ' + escapeId(c.columnAlias);
		return s;
	});
	let sql = 'SELECT ' + select.join(', ') + '\nFROM ' + generateFromBlock(aliases, foreignKeys);

	const conds: string[] = [];
	for (const c of columns) {
		if (c.table === '' || !c.useCriteria) continue;
		const cond = conditionOf(c);
		if (cond === null) continue;
		conds.push((conds.length > 0 ? ` ${c.logicalOp} ` : '') + cond);
	}
	if (conds.length > 0) sql += '\nWHERE ' + conds.join('');

	const order = columns
		.filter((c) => c.table !== '' && c.column !== '' && c.column !== '*' && c.sort !== '')
		.map((c) => `${ref(effectiveTable(c), c.column)} ${c.sort}`);
	if (order.length > 0) sql += '\nORDER BY ' + order.join(', ');

	return { ok: true, sql: sql + ';' };
}
