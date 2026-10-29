/**
 * Normalization wizard service (Normalization.php + NormalizationController.php).
 */
import { z } from 'zod';
import { sqlErrorMessage } from '../database/common';
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import { escapeQualified } from '#lib/server/db/escape.ts';
import {
	buildDistinctCountQuery,
	checkNames,
	groupDependencies,
	isDependent,
	keyName,
	partialKeys,
	SAMPLE_ROWS,
	planDecomposition,
	planRepeatingGroup,
	type DecompositionGroup
} from '#lib/sql/normalization.ts';
import { addColumns, addKey, dropColumns, type ActionResult } from '#lib/server/table/structure.ts';
import { N_, SOURCE_TRANSLATOR, type Translator } from '#lib/i18n/translator.ts';

export interface NormalizationTable {
	table: string;
	columns: { name: string; type: string; isString: boolean }[];
	pk: string[];
}

const STRING_TYPE = /^(char|varchar|tinytext|text|mediumtext|longtext|binary|varbinary)\b/i;

export async function loadTableInfo(
	dbi: DatabaseInterface,
	db: string,
	table: string
): Promise<NormalizationTable | null> {
	if ((await dbi.getTableType(db, table)) !== 'BASE TABLE') return null;
	const cols = await dbi.getColumns(db, table);
	const idx = (await dbi.getIndexes(db, table))
		.filter((i) => i.keyName === 'PRIMARY' && i.columnName)
		.sort((a, b) => a.seqInIndex - b.seqInIndex);
	return {
		table,
		columns: cols.map((c) => ({ name: c.field, type: c.type, isString: STRING_TYPE.test(c.type) })),
		pk: idx.map((i) => i.columnName as string)
	};
}

export async function listBaseTables(dbi: DatabaseInterface, db: string): Promise<string[]> {
	return (await dbi.listTables(db)).map((t) => t.name);
}

/** Normalization::findPartialDependencies: `determinant -> dependents` guessed from the first 500 rows. */
export async function findPartialDependencies(
	dbi: DatabaseInterface,
	db: string,
	table: string
): Promise<Record<string, string[]>> {
	const info = await loadTableInfo(dbi, db, table);
	if (!info || info.pk.length < 2) return {};
	const keys = partialKeys(info.pk);
	const others = info.columns.map((c) => c.name).filter((c) => !info.pk.includes(c));
	const run = async (sets: string[][]) => {
		const [rows] = await dbi.conn.query(buildDistinctCountQuery(db, table, sets));
		const r = (rows as Record<string, unknown>[])[0];
		return sets.map((_, i) => Number(r[`c${i}`] ?? 0));
	};
	const [rows] = await dbi.conn.query(
		`SELECT COUNT(*) AS n FROM (SELECT * FROM ${escapeQualified(db, table)} LIMIT ${SAMPLE_ROWS}) AS dt`
	);
	const totalRows = Number((rows as { n: unknown }[])[0].n);
	const singles = others.map((c) => [c]);
	const counts = await run([...keys, ...singles]);
	const keyCounts = counts.slice(0, keys.length);
	const colCounts = counts.slice(keys.length);
	const pairSets: string[][] = [];
	for (const k of keys) for (const c of others) pairSets.push([...k, c]);
	const pairCounts = pairSets.length ? await run(pairSets) : [];
	const result: Record<string, string[]> = {};
	keys.forEach((k, ki) => {
		others.forEach((col, ci) => {
			const dep = isDependent({
				keyCount: keyCounts[ki],
				colCount: colCounts[ci],
				pairCount: pairCounts[ki * others.length + ci],
				totalRows
			});
			if (dep) (result[keyName(k)] ??= []).push(col);
		});
	});
	return result;
}

const name = z.string().min(1).max(64);
const answers = z.array(z.object({ column: name, dependsOn: z.array(name).max(64) })).max(4096);

export const opSchema = z.discriminatedUnion('op', [
	z.object({ op: z.literal('addPrimary'), columns: z.array(name).min(1).max(64) }),
	z.object({ op: z.literal('addColumns'), payload: z.unknown() }),
	z.object({ op: z.literal('dropColumns'), columns: z.array(name).min(1).max(4096) }),
	z.object({
		op: z.literal('repeating'),
		columns: z.array(name).min(2).max(64),
		newTable: name,
		newColumn: name
	}),
	z.object({
		op: z.literal('decompose'),
		table: name,
		answers,
		names: z.record(z.string(), z.string().max(64)).default({})
	})
]);
export type Op = z.infer<typeof opSchema>;

export type OpResult = ActionResult & { tables?: string[] };

const fail = (error: string, sql: string[] = []): OpResult => ({ ok: false, error, sql });

async function exec(
	dbi: DatabaseInterface,
	statements: string[],
	dryRun: boolean
): Promise<OpResult> {
	if (dryRun) return { ok: true, sql: statements };
	const done: string[] = [];
	try {
		for (const s of statements) {
			await dbi.conn.query(s);
			done.push(s);
		}
		return { ok: true, sql: done };
	} catch (e) {
		return fail(sqlErrorMessage(e, N_('The statement failed.')), done);
	}
}

/** Plan (dryRun) or run one wizard operation on `table`. */
export async function runOperation(
	dbi: DatabaseInterface,
	db: string,
	table: string,
	raw: unknown,
	dryRun = false,
	tr: Translator = SOURCE_TRANSLATOR
): Promise<OpResult> {
	const parsed = opSchema.safeParse(raw);
	if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? tr.t('Invalid input.'));
	const op = parsed.data;
	const ctx = { dbi, db, table, tr };
	const info = await loadTableInfo(dbi, db, table);
	if (!info) return fail(tr.t('Table not found.'));

	switch (op.op) {
		case 'addPrimary':
			return addKey(ctx, { kind: 'PRIMARY', columns: op.columns, replacePrimary: false });
		case 'addColumns':
			return addColumns(ctx, op.payload);
		case 'dropColumns':
			return dropColumns(ctx, { columns: op.columns });
		case 'repeating': {
			if (info.pk.length === 0) return fail(tr.t('The table needs a primary key first.'));
			const names = new Set(info.columns.map((c) => c.name));
			const bad = op.columns.find((c) => !names.has(c) || info.pk.includes(c));
			if (bad)
				return fail(tr.t('Column {name} cannot be part of the repeating group.', { name: bad }));
			if (
				(await listBaseTables(dbi, db)).some((t) => t.toLowerCase() === op.newTable.toLowerCase())
			) {
				return fail(tr.t('Table {table} already exists.', { table: op.newTable }));
			}
			return exec(
				dbi,
				planRepeatingGroup(db, table, info.pk, op.columns, op.newTable, op.newColumn),
				dryRun
			);
		}
		case 'decompose': {
			const target = op.table === table ? info : await loadTableInfo(dbi, db, op.table);
			if (!target) return fail(tr.t('Table not found.'));
			if (target.pk.length === 0) return fail(tr.t('The table needs a primary key first.'));
			const nonPk = target.columns.map((c) => c.name).filter((c) => !target.pk.includes(c));
			const all = new Set(target.columns.map((c) => c.name));
			for (const a of op.answers) {
				if (!nonPk.includes(a.column))
					return fail(tr.t('Column {name} is not a non-key column.', { name: a.column }));
				const bad = a.dependsOn.find((d) => !all.has(d) || d === a.column);
				if (bad)
					return fail(
						tr.t('Column {name} cannot depend on {other}.', { name: a.column, other: bad })
					);
			}
			// columns without an answer depend on the whole primary key
			const answered = new Set(op.answers.map((a) => a.column));
			const full = [
				...op.answers,
				...nonPk.filter((c) => !answered.has(c)).map((c) => ({ column: c, dependsOn: [] }))
			];
			const groups: DecompositionGroup[] = groupDependencies(op.table, target.pk, full, op.names);
			const tables = await listBaseTables(dbi, db);
			const err = checkNames(op.table, groups, tables);
			if (err) return fail(err);
			if (groups.length < 2) return { ok: true, sql: [], tables: [op.table] };
			const sql = planDecomposition(
				db,
				op.table,
				target.columns.map((c) => c.name),
				groups
			);
			const res = await exec(dbi, sql, dryRun);
			return { ...res, tables: groups.map((g) => g.name) };
		}
	}
}
