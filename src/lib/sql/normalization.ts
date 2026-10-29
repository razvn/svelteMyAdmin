/**
 * Normalization wizard planners (pure; browser preview + server execution).
 * Ported from phpMyAdmin 5.2.3 Normalization.php.
 */
import { SOURCE_TRANSLATOR, type Translator } from '#lib/i18n/translator.ts';
import { buildDropColumns } from './alter-table.ts';
import { quoteId } from './column-definition.ts';

export type NormalForm = '1nf' | '2nf' | '3nf';

const ref = (db: string, table: string): string => `${quoteId(db)}.${quoteId(table)}`;
const list = (names: string[]): string => names.map(quoteId).join(', ');

/** Sample size phpMyAdmin uses when it guesses dependencies from the data. */
export const SAMPLE_ROWS = 500;

/** Every non-empty proper subset of the primary key (Normalization::getAllCombinationPartialKeys). */
export function partialKeys(pk: string[]): string[][] {
	const results: string[][] = [[]];
	for (const element of pk) {
		for (const combination of [...results]) results.push([element, ...combination]);
	}
	results.pop(); // the full key
	return results.filter((r) => r.length > 0);
}

/** `a, b` key used to identify a determinant set. */
export const keyName = (cols: string[]): string => cols.join(', ');

/** `SELECT COUNT(DISTINCT ...) AS c0, ... FROM (SELECT * FROM t LIMIT 500) AS dt`. */
export function buildDistinctCountQuery(
	db: string,
	table: string,
	sets: string[][],
	limit = SAMPLE_ROWS
): string {
	const parts = sets.map((cols, i) => `COUNT(DISTINCT ${list(cols)}) AS c${i}`);
	return `SELECT ${parts.join(', ')} FROM (SELECT * FROM ${ref(db, table)} LIMIT ${limit}) AS dt`;
}

export interface DependencyCounts {
	/** distinct values of the partial key */
	keyCount: number;
	/** distinct values of the column */
	colCount: number;
	/** distinct values of (key, column) */
	pairCount: number;
	/** rows in the sample */
	totalRows: number;
}

/** Normalization::checkPartialDependency. */
export function isDependent(c: DependencyCounts): boolean {
	if (c.keyCount && c.keyCount === c.colCount && c.colCount === c.pairCount) return true;
	return !!c.totalRows && c.totalRows === c.keyCount;
}

/** One table of a decomposition: `key` is its primary key, `dependents` the other columns. */
export interface DecompositionGroup {
	key: string[];
	dependents: string[];
	/** Table name; the group whose name equals the original table stays in it. */
	name: string;
}

/**
 * Statements that split `table` into the given groups (2NF and 3NF share them):
 * CREATE TABLE ... SELECT DISTINCT + ADD PRIMARY KEY for every group with a new name, then drop the
 * moved columns from the original (or drop it when no group keeps its name).
 */
export function planDecomposition(
	db: string,
	table: string,
	allColumns: string[],
	groups: DecompositionGroup[]
): string[] {
	const sql: string[] = [];
	const kept = groups.find((g) => g.name === table);
	for (const g of groups) {
		if (g.name === table) continue;
		sql.push(
			`CREATE TABLE ${ref(db, g.name)} SELECT DISTINCT ${list([...g.key, ...g.dependents])} FROM ${ref(db, table)};`,
			`ALTER TABLE ${ref(db, g.name)} ADD PRIMARY KEY (${list(g.key)});`
		);
	}
	if (kept) {
		const present = new Set([...kept.key, ...kept.dependents]);
		// determinants of the other groups stay as the link between the tables
		for (const g of groups) if (g !== kept) for (const k of g.key) present.add(k);
		const drop = allColumns.filter((c) => !present.has(c));
		if (drop.length) sql.push(buildDropColumns(db, table, drop));
	} else {
		sql.push(`DROP TABLE ${ref(db, table)};`);
	}
	return sql;
}

/**
 * Group the user's answers ("column X depends on key set K") into decomposition groups.
 * An empty determinant means "depends on the whole primary key" and stays in the original table.
 * `names` maps a group key (see `keyName`) to the wanted table name.
 */
export function groupDependencies(
	table: string,
	pk: string[],
	answers: { column: string; dependsOn: string[] }[],
	names: Record<string, string> = {}
): DecompositionGroup[] {
	const pkKey = keyName(pk);
	const map = new Map<string, DecompositionGroup>();
	map.set(pkKey, { key: pk, dependents: [], name: table });
	for (const a of answers) {
		const key = a.dependsOn.length ? a.dependsOn : pk;
		const k = keyName(key);
		let g = map.get(k);
		if (!g) map.set(k, (g = { key, dependents: [], name: '' }));
		g.dependents.push(a.column);
	}
	let n = 1;
	for (const [k, g] of map) {
		if (k === pkKey) g.name = names[k] || table;
		else {
			n++;
			g.name = names[k] || `${table}_${n}`;
		}
	}
	return [...map.values()];
}

/** Normalization::moveRepeatingGroup: UNION the repeating columns into a new table, drop them. */
export function planRepeatingGroup(
	db: string,
	table: string,
	pk: string[],
	repeating: string[],
	newTable: string,
	newColumn: string
): string[] {
	const select = repeating
		.map((c) => `SELECT ${list(pk)}, ${quoteId(c)} AS ${quoteId(newColumn)} FROM ${ref(db, table)}`)
		.join(' UNION ');
	return [`CREATE TABLE ${ref(db, newTable)} ${select};`, buildDropColumns(db, table, repeating)];
}

/** Validate a decomposition: unique names, none clashing with `existing` tables (except the original). */
export function checkNames(
	table: string,
	groups: DecompositionGroup[],
	existing: string[],
	{ t }: Pick<Translator, 't'> = SOURCE_TRANSLATOR
): string {
	const seen = new Set<string>();
	const lower = new Set(existing.map((t) => t.toLowerCase()));
	for (const g of groups) {
		if (!g.name.trim()) return t('Give a name to every table.');
		if (g.name.length > 64) return t('Table name is too long.');
		const l = g.name.toLowerCase();
		if (seen.has(l)) return t('Table name {name} is used twice.', { name: g.name });
		seen.add(l);
		if (g.name !== table && lower.has(l)) return t('Table {name} already exists.', { name: g.name });
	}
	return '';
}
