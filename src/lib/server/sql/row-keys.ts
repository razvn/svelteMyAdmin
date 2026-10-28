/**
 * Row actions for arbitrary result sets: only when every column comes from one base table, the
 * result contains all columns of its primary/unique key, then each row gets a signed unique
 * condition exactly like table browse (Sql::resultSetHasUniqueKey / Util::getUniqueCondition).
 */
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import { signClause } from '#lib/server/table/signed-clause.ts';
import {
	conditionColumns,
	uniqueCondition,
	type ConditionColumn
} from '#lib/server/table/unique-condition.ts';
import type { FieldMeta } from '#lib/sql/run-types.ts';
import type { RowKeyResolver } from './execute.ts';

/** The single base table of a result, or null (expressions, joins, derived tables). */
export function singleSource(fields: FieldMeta[]): { db: string; table: string } | null {
	if (!fields.length) return null;
	const { db, orgTable } = fields[0];
	if (!db || !orgTable) return null;
	if (fields.some((f) => f.db !== db || f.orgTable !== orgTable || f.orgName === '')) return null;
	if (new Set(fields.map((f) => f.orgName)).size !== fields.length) return null;
	return { db, table: orgTable };
}

export function createRowKeyResolver(dbi: DatabaseInterface, secret: string): RowKeyResolver {
	const cache = new Map<string, Promise<ConditionColumn[] | null>>();

	const load = (db: string, table: string): Promise<ConditionColumn[] | null> => {
		const key = `${db}\0${table}`;
		let hit = cache.get(key);
		if (!hit) {
			hit = (async () => {
				const type = await dbi.getTableType(db, table);
				if (type !== 'BASE TABLE') return null;
				const info = await dbi.getColumns(db, table);
				return conditionColumns(info, await dbi.getIndexes(db, table));
			})().catch(() => null);
			cache.set(key, hit);
		}
		return hit;
	};

	return async (fields, rows) => {
		const source = singleSource(fields);
		if (!source) return null;
		const tableCols = await load(source.db, source.table);
		if (!tableCols) return null;
		const keyCols = tableCols.filter((c) => c.key !== null);
		if (!keyCols.length) return null;
		const aligned: ConditionColumn[] = [];
		for (const f of fields) {
			const c = tableCols.find((t) => t.name === f.orgName);
			if (!c) return null;
			aligned.push(c);
		}
		// The key must be complete in the result, else rows could not be told apart.
		if (!keyCols.every((k) => aligned.some((a) => a.name === k.name))) return null;
		const keys = [];
		for (const row of rows) {
			const cond = uniqueCondition(source.table, aligned, row, true);
			if (!cond.clause) return null;
			keys.push({
				where: cond.clause,
				sig: signClause(secret, source.db, source.table, cond.clause)
			});
		}
		return { keys, source };
	};
}
