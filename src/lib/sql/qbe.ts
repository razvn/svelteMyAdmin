/**
 * Query by example SQL generation, a port of phpMyAdmin's Database\Qbe
 * (getSelectClause, getWhereClause, getOrderByClause, getFromClause, getJoinForFromClause, ...).
 *
 * The grid is a plain state object; criteria texts are inserted as is (`= 'x'`, `> 3`), exactly like
 * phpMyAdmin. Everything here is pure so it runs in the browser (live preview) and in tests.
 *
 * Deliberate differences from the PHP code (all bug fixes of obviously unintended behaviour):
 * - unique/index candidates are looked up in the *set* of selected columns (PHP does `isset()` on a
 *   list, which is never true);
 * - when the master table falls back to the where-clause columns, their tables are used (PHP keeps
 *   the `table.column` strings);
 * - the AND/OR operator in front of the first extra criteria row is dropped when nothing precedes it
 *   (PHP emits `WHERE \nOR (...)`).
 */
import { escapeId } from './escape.ts';
import type { QuerySchemaData } from './query-schema.ts';

export type AndOr = 'and' | 'or';
export type SortDir = '' | 'ASC' | 'DESC';

export interface QbeColumn {
	/** `` `table`.`column` `` or `` `table`.* ``; empty when no field is chosen. */
	column: string;
	alias: string;
	show: boolean;
	sort: SortDir;
	/** Sort position as typed ("1", "2", ...); empty when unused. */
	sortOrder: string;
	/** Criteria of the first row, inserted after the field (`= 'x'`). */
	criteria: string;
	/** Operator joining this column's criteria with the next column's. */
	andOr: AndOr;
}

export interface QbeRow {
	/** Operator joining this extra criteria row with the previous ones. */
	andOr: AndOr;
	/** One criteria text per column (same indexes as `QbeState.columns`). */
	cells: string[];
}

export interface QbeState {
	columns: QbeColumn[];
	rows: QbeRow[];
}

export const QBE_DEFAULT_COLUMNS = 3;
export const QBE_MAX_ROWS = 101; // phpMyAdmin: rows are capped at 100 (+ the first one)

export function emptyColumn(): QbeColumn {
	return {
		column: '',
		alias: '',
		show: false,
		sort: '',
		sortOrder: '',
		criteria: '',
		andOr: 'and'
	};
}

export function emptyState(columns = QBE_DEFAULT_COLUMNS, rows = 1): QbeState {
	return {
		columns: Array.from({ length: columns }, emptyColumn),
		rows: Array.from({ length: rows }, () => ({
			andOr: 'or' as AndOr,
			cells: Array<string>(columns).fill('')
		}))
	};
}

/** PHP `empty()` for strings. */
const isEmpty = (s: string | undefined): boolean => s === undefined || s === '' || s === '0';
const upper = (s: string) => s.toUpperCase();

/** `` `t`.`c` `` (or `` `t`.* ``) for the field select. */
export function columnRef(table: string, column: string): string {
	return column === '*' ? `${escapeId(table)}.*` : `${escapeId(table)}.${escapeId(column)}`;
}

const REF_RE = /^`((?:[^`]|``)*)`\.(?:`((?:[^`]|``)*)`|(\*))$/;

export function parseColumnRef(ref: string): { table: string; column: string } | null {
	const m = REF_RE.exec(ref);
	if (!m) return null;
	return { table: m[1].replaceAll('``', '`'), column: m[3] ?? m[2].replaceAll('``', '`') };
}

// ---- SELECT / WHERE / ORDER BY --------------------------------------------------------------

export function selectClause(state: QbeState): string {
	const parts: string[] = [];
	for (const c of state.columns) {
		if (isEmpty(c.column) || !c.show) continue;
		parts.push(c.column + (isEmpty(c.alias) ? '' : ' AS ' + escapeId(c.alias)));
	}
	return parts.length ? 'SELECT ' + parts.join(', ') + '\n' : '';
}

export function whereClause(state: QbeState): string {
	const cols = state.columns;
	let where = '';
	let count = 0;
	let last = -1;
	cols.forEach((c, i) => {
		const ok = !isEmpty(c.column) && !isEmpty(c.criteria);
		if (last >= 0 && ok && i) where += ' ' + upper(cols[last].andOr) + ' ';
		if (!ok) return;
		where += '(' + c.column + ' ' + c.criteria + ')';
		last = i;
		count++;
	});
	if (count > 1) where = '(' + where + ')';

	for (const row of state.rows) {
		let or = '';
		let orCount = 0;
		let lastOr = -1;
		cols.forEach((c, i) => {
			const cell = row.cells[i];
			const ok = !isEmpty(c.column) && !isEmpty(cell);
			if (ok && i && lastOr >= 0) or += ' ' + upper(cols[lastOr].andOr) + ' ';
			if (!ok) return;
			or += '(' + c.column + ' ' + cell + ')';
			lastOr = i;
			orCount++;
		});
		if (orCount > 1) or = '(' + or + ')';
		if (or === '') continue;
		where += where === '' ? or : '\n' + upper(row.andOr) + ' ' + or;
	}

	return where !== '' && where !== '()' ? 'WHERE ' + where + '\n' : '';
}

/** PHP 8 loose comparison of two strings (numeric strings compare as numbers). */
function phpCompare(a: string, b: string): number {
	const na = a.trim() !== '' && !Number.isNaN(Number(a));
	const nb = b.trim() !== '' && !Number.isNaN(Number(b));
	if (na && nb) return Math.sign(Number(a) - Number(b));
	return a < b ? -1 : a > b ? 1 : 0;
}

export function orderByClause(state: QbeState): string {
	let entries = state.columns.map((c) => ({
		column: c.column,
		sort: c.sort as string,
		order: c.sortOrder
	}));
	// phpMyAdmin only sorts by the "Sort order" row when *every* column has one (array_multisort
	// needs equally sized arrays); ties fall back to the sort direction and the column.
	if (entries.length > 0 && entries.every((e) => !isEmpty(e.order))) {
		entries = entries
			.map((e, i) => ({ e, i }))
			.sort(
				(x, y) =>
					phpCompare(x.e.order, y.e.order) ||
					phpCompare(x.e.sort, y.e.sort) ||
					phpCompare(x.e.column, y.e.column) ||
					x.i - y.i
			)
			.map((x) => x.e);
	}
	const parts: string[] = [];
	for (const e of entries) {
		if (e.column === '' && e.sort === '') continue;
		if (e.column.slice(-2) === '.*') continue; // sorting is not available with the * selector
		if (e.sort === '') continue;
		parts.push(e.column + ' ' + e.sort);
	}
	return parts.length ? 'ORDER BY ' + parts.join(', ') + '\n' : '';
}

// ---- FROM / JOIN ----------------------------------------------------------------------------

export interface QbeForeigners {
	/** Internal relations (`pma__relation`), keyed in phpMyAdmin by master field. */
	internal: { field: string; foreignTable: string; foreignField: string }[];
	/** InnoDB foreign keys (one entry per constraint, possibly composite). */
	keys: { indexList: string[]; refTable: string; refIndexList: string[] }[];
}

export interface QbeSchema {
	foreigners(table: string): QbeForeigners;
	/** Tables of this database that reference `table` through a foreign key. */
	childTables(table: string): string[];
	indexes(table: string): { column: string; nonUnique: boolean }[];
	rowCount(table: string): number;
}

/** Build the lookups the join logic needs from the serialisable schema. */
export function schemaFromData(data: QuerySchemaData): QbeSchema {
	const foreigners = new Map<string, QbeForeigners>();
	const get = (t: string): QbeForeigners => {
		let f = foreigners.get(t);
		if (!f) foreigners.set(t, (f = { internal: [], keys: [] }));
		return f;
	};
	for (const r of data.internalRelations) {
		get(r.table).internal.push({
			field: r.field,
			foreignTable: r.refTable,
			foreignField: r.refField
		});
	}
	const constraints = new Map<string, QbeForeigners['keys'][number]>();
	const children = new Map<string, string[]>();
	for (const k of data.foreignKeys) {
		const id = k.table + '\0' + k.constraint;
		let key = constraints.get(id);
		if (!key) {
			key = { indexList: [], refTable: k.refTable, refIndexList: [] };
			constraints.set(id, key);
			get(k.table).keys.push(key);
			const list = children.get(k.refTable) ?? [];
			list.push(k.table);
			children.set(k.refTable, list);
		}
		key.indexList.push(k.column);
		key.refIndexList.push(k.refColumn);
	}
	const idx = new Map<string, { column: string; nonUnique: boolean }[]>();
	for (const i of data.indexes) {
		const list = idx.get(i.table) ?? [];
		list.push({ column: i.column, nonUnique: i.nonUnique });
		idx.set(i.table, list);
	}
	const rows = new Map(data.tables.map((t) => [t.name, t.rows]));
	return {
		foreigners: (t) => foreigners.get(t) ?? { internal: [], keys: [] },
		childTables: (t) => children.get(t) ?? [],
		indexes: (t) => idx.get(t) ?? [],
		rowCount: (t) => rows.get(t) ?? 0
	};
}

/** Columns whose first-row criteria starts with `=` or mentions `is` (Qbe::getWhereClauseTablesAndColumns). */
function whereClauseTablesAndColumns(state: QbeState): { tables: string[]; columns: string[] } {
	const tables = new Set<string>();
	const columns = new Set<string>();
	for (const c of state.columns) {
		const ref = parseColumnRef(c.column);
		if (!ref || ref.table === '' || ref.column === '') continue;
		if (isEmpty(c.criteria)) continue;
		if (c.criteria[0] !== '=' && !c.criteria.toLowerCase().includes('is')) continue;
		columns.add(ref.table + '.' + ref.column);
		tables.add(ref.table);
	}
	return { tables: [...tables], columns: [...columns] };
}

function leftJoinColumnCandidates(
	schema: QbeSchema,
	searchTables: string[],
	searchColumns: Set<string>,
	whereColumns: string[]
): string[] {
	const where = new Set(whereColumns);
	const unique = new Map<string, 'Y' | 'N'>();
	const index = new Map<string, 'Y' | 'N'>();
	for (const table of searchTables) {
		for (const ix of schema.indexes(table)) {
			const column = table + '.' + ix.column;
			if (!searchColumns.has(column)) continue;
			(ix.nonUnique ? index : unique).set(column, where.has(column) ? 'Y' : 'N');
		}
	}
	// Qbe::getLeftJoinColumnCandidatesBest
	const best = unique.size > 0 ? unique : index.size > 0 ? index : null;
	if (best) {
		const veryGood: string[] = [];
		const stillGood: string[] = [];
		for (const [column, isWhere] of best) {
			const table = column.slice(0, column.indexOf('.'));
			(isWhere === 'Y' ? veryGood : stillGood).push(table);
		}
		return veryGood.length > 0 ? veryGood : stillGood;
	}
	if (whereColumns.length > 0) {
		return [...new Set(whereColumns.map((c) => c.slice(0, c.indexOf('.'))))];
	}
	return searchTables;
}

function masterTable(
	schema: QbeSchema,
	searchTables: string[],
	searchColumns: Set<string>,
	where: { tables: string[]; columns: string[] }
): string {
	if (where.tables.length === 1) return where.tables[0];

	let candidates = leftJoinColumnCandidates(schema, searchTables, searchColumns, where.columns);

	// Prefer referenced (foreign) tables: all their rows must show whether or not a child matches.
	const foreignTables: string[] = [];
	for (const table of candidates) {
		const f = schema.foreigners(table);
		for (const r of f.internal) {
			if (candidates.includes(r.foreignTable) && !foreignTables.includes(r.foreignTable)) {
				foreignTables.push(r.foreignTable);
			}
		}
		for (const k of f.keys) {
			if (candidates.includes(k.refTable) && !foreignTables.includes(k.refTable)) {
				foreignTables.push(k.refTable);
			}
		}
	}
	if (foreignTables.length) candidates = foreignTables;

	if (candidates.length <= 1) return candidates[0] ?? '';

	// several candidates: the largest table (first one wins ties)
	let maxSize = -1;
	let result = '';
	for (const table of new Set(candidates)) {
		const size = schema.rowCount(table);
		if (size <= maxSize) continue;
		maxSize = size;
		result = table;
	}
	return result;
}

type Relations = Map<string, Map<string, string>>;

/** Qbe::loadRelationsForTable: `relations[table][foreignTable] = join condition`. */
function loadRelationsForTable(relations: Relations, schema: QbeSchema, table: string): void {
	const map = new Map<string, string>();
	relations.set(table, map);
	const f = schema.foreigners(table);
	for (const r of f.internal) {
		map.set(
			r.foreignTable,
			`${escapeId(table)}.${escapeId(r.field)} = ${escapeId(r.foreignTable)}.${escapeId(r.foreignField)}`
		);
	}
	for (const k of f.keys) {
		map.set(
			k.refTable,
			k.indexList
				.map(
					(col, i) =>
						`${escapeId(table)}.${escapeId(col)} = ${escapeId(k.refTable)}.${escapeId(k.refIndexList[i])}`
				)
				.join(' AND ')
		);
	}
}

/** Qbe::fillJoinClauses */
function fillJoinClauses(
	finalized: Map<string, string>,
	relations: Relations,
	searchTables: string[]
): void {
	for (;;) {
		let added = false;
		for (const master of searchTables) {
			const foreignData = relations.get(master) ?? new Map<string, string>();
			for (const [foreign, clause] of foreignData) {
				if (!finalized.has(master) && finalized.has(foreign)) {
					finalized.set(master, clause);
					added = true;
				} else if (
					!finalized.has(foreign) &&
					finalized.has(master) &&
					searchTables.includes(foreign)
				) {
					finalized.set(foreign, clause);
					added = true;
				}
				if (!added) continue;
				if (finalized.size === searchTables.length) return;
			}
		}
		if (!added) return;
	}
}

const diff = (tables: string[], finalized: Map<string, string>) =>
	[...new Set(tables)].filter((t) => !finalized.has(t));

function joinForFromClause(
	state: QbeState,
	schema: QbeSchema,
	searchTablesIn: string[],
	searchColumns: Set<string>
): string {
	let searchTables = searchTablesIn;
	const relations: Relations = new Map();
	for (const t of searchTables) loadRelationsForTable(relations, schema, t);

	const where = whereClauseTablesAndColumns(state);
	const master = masterTable(schema, searchTables, searchColumns, where);

	const finalized = new Map<string, string>();
	if (master.length > 0) finalized.set(master, '');
	fillJoinClauses(finalized, relations, searchTables);

	let join = '';
	let unfinalized = diff(searchTables, finalized);
	if (unfinalized.length > 0) {
		// look for intermediary tables (children of the unfinalized ones) that connect the clusters
		outer: for (const one of unfinalized) {
			for (const table of schema.childTables(one)) {
				loadRelationsForTable(relations, schema, table);
				const tempFinalized = new Map(finalized);
				const tempSearchTables = [...searchTables, table];
				fillJoinClauses(tempFinalized, relations, tempSearchTables);
				const tempUnfinalized = diff(tempSearchTables, tempFinalized);
				if (tempUnfinalized.length < unfinalized.length) {
					finalized.clear();
					for (const [k, v] of tempFinalized) finalized.set(k, v);
					searchTables = tempSearchTables;
				}
				if (tempUnfinalized.length === 0) break outer;
			}
		}
		unfinalized = diff(searchTables, finalized);
		if (unfinalized.length > 0) join += unfinalized.map(escapeId).join(', ');
	}

	let first = true;
	for (const [table, clause] of finalized) {
		if (first) {
			if (join !== '') join += ', ';
			join += escapeId(table);
			first = false;
		} else {
			join += '\n    LEFT JOIN ' + escapeId(table) + ' ON ' + clause;
		}
	}
	return join;
}

export function fromClause(state: QbeState, schema: QbeSchema): string {
	const searchTables: string[] = [];
	const searchColumns = new Set<string>();
	for (const c of state.columns) {
		const ref = parseColumnRef(c.column);
		if (!ref || ref.table === '' || ref.column === '') continue;
		if (!searchTables.includes(ref.table)) searchTables.push(ref.table);
		searchColumns.add(ref.table + '.' + ref.column);
	}
	if (searchTables.length === 0) return '';
	const join = joinForFromClause(state, schema, searchTables, searchColumns);
	// no relations at all: plain cartesian product
	return join !== '' ? join : searchTables.map(escapeId).join(', ');
}

/** Qbe::getSQLQuery */
export function buildQbeQuery(state: QbeState, schema: QbeSchema): string {
	let sql = selectClause(state);
	const from = fromClause(state, schema);
	if (from !== '') sql += 'FROM ' + from + '\n';
	sql += whereClause(state);
	sql += orderByClause(state);
	return sql;
}

// ---- grid editing (Ins / Del / add) ---------------------------------------------------------

export interface QbeEdits {
	/** Insert an empty column before these column indexes. */
	insertColumns?: number[];
	deleteColumns?: number[];
	insertRows?: number[];
	deleteRows?: number[];
	/** "Add/Remove columns": negative removes from the end (never below 0). */
	addColumns?: number;
	addRows?: number;
}

/** Apply the Ins/Del checkboxes and the add counters like Qbe's getNewColumnCount / getInsDelAndOrCriteriaRows. */
export function applyEdits(state: QbeState, edits: QbeEdits): QbeState {
	let columns = state.columns.map((c) => ({ ...c }));
	let rows = state.rows.map((r) => ({ ...r, cells: [...r.cells] }));

	const addColumns = edits.addColumns ?? 0;
	if (addColumns > 0) {
		for (let i = 0; i < addColumns; i++) columns.push(emptyColumn());
		rows.forEach((r) => r.cells.push(...Array<string>(addColumns).fill('')));
	} else if (addColumns < 0) {
		const keep = Math.max(columns.length + addColumns, 0);
		columns = columns.slice(0, keep);
		rows.forEach((r) => (r.cells = r.cells.slice(0, keep)));
	}

	const insCols = new Set(edits.insertColumns ?? []);
	const delCols = new Set(edits.deleteColumns ?? []);
	if (insCols.size || delCols.size) {
		const newColumns: QbeColumn[] = [];
		const keepIdx: (number | null)[] = []; // null = inserted blank
		columns.forEach((c, i) => {
			if (insCols.has(i)) {
				newColumns.push(emptyColumn());
				keepIdx.push(null);
			}
			if (delCols.has(i)) return;
			newColumns.push(c);
			keepIdx.push(i);
		});
		columns = newColumns;
		rows = rows.map((r) => ({
			...r,
			cells: keepIdx.map((k) => (k === null ? '' : (r.cells[k] ?? '')))
		}));
	}

	const addRows = edits.addRows ?? 0;
	if (addRows > 0) {
		for (let i = 0; i < addRows; i++) {
			rows.push({ andOr: 'or', cells: Array<string>(columns.length).fill('') });
		}
	} else if (addRows < 0) {
		rows = rows.slice(0, Math.max(rows.length + addRows, 0));
	}

	const insRows = new Set(edits.insertRows ?? []);
	const delRows = new Set(edits.deleteRows ?? []);
	if (insRows.size || delRows.size) {
		const out: QbeRow[] = [];
		rows.forEach((r, i) => {
			if (insRows.has(i)) out.push({ andOr: 'or', cells: Array<string>(columns.length).fill('') });
			if (delRows.has(i)) return;
			out.push(r);
		});
		rows = out;
	}
	rows = rows.slice(0, QBE_MAX_ROWS);

	return { columns, rows };
}

// ---- saved searches (pma__savedsearches.search_data, phpMyAdmin compatible) -----------------

export type SavedSearchData = Record<string, unknown>;

/**
 * Same keys as phpMyAdmin's SavedSearches::setCriterias (so both apps can share a pmadb), plus
 * `criteriaAlias` and `criteriaSortOrder` which phpMyAdmin does not persist.
 */
export function toSearchData(state: QbeState, tableList: string[]): SavedSearchData {
	const data: SavedSearchData = {
		criteriaColumnCount: state.columns.length,
		criteriaColumn: state.columns.map((c) => c.column),
		criteriaSort: state.columns.map((c) => c.sort),
		criteriaShow: Object.fromEntries(
			state.columns.flatMap((c, i) => (c.show ? [[String(i), 'on']] : []))
		),
		criteria: state.columns.map((c) => c.criteria),
		criteriaAndOrColumn: state.columns.map((c) => c.andOr),
		criteriaAndOrRow: state.rows.map((r) => r.andOr),
		criteriaAlias: state.columns.map((c) => c.alias),
		criteriaSortOrder: state.columns.map((c) => c.sortOrder),
		rows: Math.max(state.rows.length - 1, 0),
		TableList: tableList
	};
	state.rows.forEach((r, i) => (data['Or' + i] = r.cells));
	return data;
}

const asList = (v: unknown): unknown[] => {
	if (Array.isArray(v)) return v;
	if (v && typeof v === 'object') {
		// PHP encodes sparse arrays as objects keyed by index
		const out: unknown[] = [];
		for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[Number(k)] = val;
		return out;
	}
	return [];
};
const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

export function fromSearchData(data: SavedSearchData): { state: QbeState; tableList: string[] } {
	const count = Math.min(Math.max(Number(data.criteriaColumnCount) || 0, 0), 200);
	const column = asList(data.criteriaColumn);
	const sort = asList(data.criteriaSort);
	const show = asList(data.criteriaShow);
	const criteria = asList(data.criteria);
	const andOrCol = asList(data.criteriaAndOrColumn);
	const alias = asList(data.criteriaAlias);
	const sortOrder = asList(data.criteriaSortOrder);
	const columns: QbeColumn[] = Array.from({ length: count }, (_, i) => ({
		column: str(column[i]),
		alias: str(alias[i]),
		show: show[i] === 'on',
		sort: sort[i] === 'ASC' || sort[i] === 'DESC' ? sort[i] : '',
		sortOrder: str(sortOrder[i]),
		criteria: str(criteria[i]),
		andOr: andOrCol[i] === 'or' ? 'or' : 'and'
	}));
	const rowCount = Math.min(Math.max(Number(data.rows) || 0, 0), 100) + 1;
	const andOrRow = asList(data.criteriaAndOrRow);
	const rows: QbeRow[] = Array.from({ length: rowCount }, (_, r) => {
		const cells = asList(data['Or' + r]);
		return {
			andOr: andOrRow[r] === 'and' ? 'and' : 'or',
			cells: Array.from({ length: count }, (_, i) => str(cells[i]))
		};
	});
	return {
		state: { columns, rows },
		tableList: asList(data.TableList).map(str).filter(Boolean)
	};
}
