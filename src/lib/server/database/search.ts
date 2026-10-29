/**
 * Database > Search service (port of libraries/classes/Database/Search.php): parses the form
 * criteria from the query string, counts matches per table and deletes them.
 * SQL text comes from `#lib/sql/db-search.ts`; values always go through `?` placeholders.
 */
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { z } from 'zod';
import { searchSqls, type SearchCriteria, type SearchType } from '#lib/sql/db-search.ts';
import type { DatabaseInterface, TableInfo } from '#lib/server/db/dbi.ts';
import { SOURCE_TRANSLATOR, type Translator } from '#lib/i18n/translator.ts';

const searchTypeSchema = z
	.enum(['1', '2', '3', '4', '5'])
	.catch('1')
	.transform((v) => Number(v) as SearchType);

const requestSchema = z.object({
	criteriaSearchString: z.string().catch(''),
	criteriaSearchType: searchTypeSchema,
	criteriaColumnName: z.string().catch(''),
	criteriaTables: z.array(z.string()).catch([])
});

export interface SearchRequest {
	criteria: SearchCriteria;
	/** Tables checked in the form, unfiltered (names are validated against the database later). */
	tables: string[];
	/** Form submitted with a usable search: `submit_search` present, words and tables given. */
	submitted: boolean;
}

/** Parse the GET criteria (`criteriaSearchString`, `criteriaSearchType`, ...) like Search::setSearchParams(). */
export function parseSearchRequest(params: URLSearchParams): SearchRequest {
	const parsed = requestSchema.parse({
		criteriaSearchString: params.get('criteriaSearchString') ?? '',
		criteriaSearchType: params.get('criteriaSearchType') ?? '1',
		criteriaColumnName: params.get('criteriaColumnName') ?? '',
		criteriaTables: params.getAll('criteriaTables')
	});
	const tables = [...new Set(parsed.criteriaTables)];
	return {
		criteria: {
			searchString: parsed.criteriaSearchString,
			searchType: parsed.criteriaSearchType,
			columnName: parsed.criteriaColumnName
		},
		tables,
		submitted:
			params.has('submit_search') && parsed.criteriaSearchString !== '' && tables.length > 0
	};
}

/** Tables of the request that exist in the database (array_intersect in Search.php). */
function selectedTables(tables: TableInfo[], req: SearchRequest): TableInfo[] {
	const byName = new Map(tables.map((t) => [t.name, t]));
	return req.tables.flatMap((name) => {
		const info = byName.get(name);
		return info ? [info] : [];
	});
}

export interface TableSearchRow {
	table: string;
	/** Views are searchable but rows cannot be deleted from them. */
	isView: boolean;
	count: number;
	/** Delete statement with inlined values, for the confirmation dialog; null when no match. */
	deleteSql: string | null;
}

/** Count matches for every selected table (Search::getSearchResults). */
export async function searchTables(
	dbi: DatabaseInterface,
	db: string,
	tables: TableInfo[],
	req: SearchRequest
): Promise<TableSearchRow[]> {
	const rows: TableSearchRow[] = [];
	for (const info of selectedTables(tables, req)) {
		const columns = (await dbi.getColumns(db, info.name)).map((c) => c.field);
		const sql = searchSqls(db, info.name, columns, req.criteria);
		const [result] = await dbi.conn.query<RowDataPacket[]>(sql.count, sql.params);
		const count = Number(result[0]?.count ?? 0);
		rows.push({
			table: info.name,
			isView: info.type !== 'BASE TABLE',
			count,
			deleteSql:
				count > 0 ? searchSqls(db, info.name, columns, req.criteria, 'literals').delete : null
		});
	}
	return rows;
}

export type DeleteResult =
	{ ok: true; table: string; deleted: number } | { ok: false; error: string };

/**
 * Delete the rows of one table that match the search. The table must be part of the request,
 * must exist, and must be a base table (not a view).
 */
export async function deleteMatches(
	dbi: DatabaseInterface,
	db: string,
	tables: TableInfo[],
	req: SearchRequest,
	table: string,
	tr: Translator = SOURCE_TRANSLATOR
): Promise<DeleteResult> {
	if (!req.tables.includes(table)) return { ok: false, error: tr.t('Table is not part of this search.') };
	const info = selectedTables(tables, req).find((t) => t.name === table);
	if (!info) return { ok: false, error: tr.t('Table does not exist.') };
	if (info.type !== 'BASE TABLE')
		return { ok: false, error: tr.t('Rows cannot be deleted from a view.') };

	const columns = (await dbi.getColumns(db, table)).map((c) => c.field);
	const sql = searchSqls(db, table, columns, req.criteria);
	const [result] = await dbi.conn.query<ResultSetHeader>(sql.delete, sql.params);
	return { ok: true, table, deleted: result.affectedRows };
}
