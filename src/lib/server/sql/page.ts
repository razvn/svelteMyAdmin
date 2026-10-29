/**
 * Shared load/action logic of the three SQL pages (`/server/sql`, `/db/[db]/sql`,
 * `/db/[db]/table/[table]/sql`): Controllers/{Server,Database,Table}/SqlController.php.
 */
import { fail, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { getSecret } from '#lib/server/auth/session.ts';
import { escapeId } from '#lib/server/db/escape.ts';
import { recordHistory } from '#lib/server/pmadb/history.ts';
import { attachTransforms } from '#lib/server/transformations/sql-results.ts';
import { runScript } from './execute.ts';
import { createRowKeyResolver } from './row-keys.ts';
import type { ScriptResult, SqlPageSettings, SqlRunOptions, SqlScope } from '#lib/sql/run-types.ts';

export type { SqlPageSettings, SqlRunOptions, SqlScope };

export interface SqlTableColumns {
	name: string;
	columns: string[];
}

export interface SqlPageData {
	scope: SqlScope;
	/** Initial content of the query box (`?sql_query=` or the table default). Never executed. */
	prefill: string;
	/** Tables (db level) or the single table (table level) with their columns. */
	tables: SqlTableColumns[];
	settings: SqlPageSettings;
}

/** What the `run` action returns (the page's `form` prop). */
export interface SqlRunResult {
	result: ScriptResult;
	options: SqlRunOptions;
	/** The submitted query box content. */
	sqlQuery: string;
	/** Put `sqlQuery` back into the box ("Show this query here again" / "Retain query box"). */
	refill: boolean;
}

const MAX_QUERY_LENGTH = 4_000_000;
const MAX_TABLE_COLUMNS = 3000;

export const defaultTableQuery = (table: string): string =>
	`SELECT * FROM ${escapeId(table)} WHERE 1`;

export async function loadSqlPage(
	{ locals, url }: Pick<RequestEvent, 'locals' | 'url'>,
	scope: SqlScope
): Promise<SqlPageData> {
	const dbi = await locals.dbi;
	const config = locals.config;
	const info = await dbi.getServerInfo();

	let tables: SqlTableColumns[] = [];
	if (scope.level === 'table') {
		const cols = await dbi.getColumns(scope.db, scope.table);
		tables = [{ name: scope.table, columns: cols.map((c) => c.field) }];
	} else if (scope.level === 'db') {
		const [rows] = await (
			await locals.db
		).query(
			'SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS ' +
				'WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION LIMIT ?',
			[scope.db, MAX_TABLE_COLUMNS]
		);
		const byTable = new Map<string, string[]>();
		for (const r of rows as { t: string; c: string }[]) {
			byTable.set(r.t, [...(byTable.get(r.t) ?? []), r.c]);
		}
		tables = [...byTable].map(([name, columns]) => ({ name, columns }));
	}

	// `?sql_query=` only fills the box; running needs a POST.
	const requested = url.searchParams.get('sql_query');
	const prefill =
		requested !== null
			? requested.slice(0, MAX_QUERY_LENGTH)
			: scope.level === 'table'
				? defaultTableQuery(scope.table)
				: '';

	return {
		scope,
		prefill,
		tables,
		settings: {
			maxRows: config.MaxRows,
			showSql: config.ShowSQL,
			maxCharsInSql: config.MaxCharactersInDisplayedSQL,
			retainQueryBox: config.RetainQueryBox,
			limitChars: config.LimitChars,
			order: config.Order,
			sqlQuery: config.SQLQuery,
			explainTree: info.serverType !== 'MariaDB' && info.versionInt >= 80016,
			profilingAvailable: true,
			dialect: info.serverType === 'MariaDB' ? 'mariadb' : 'mysql'
		}
	};
}

/** Executed statements of a script as history entries (db/table of the page the query ran from). */
export function historyEntries(scope: SqlScope, result: ScriptResult) {
	return result.statements.map((s) => ({
		db: scope.level === 'server' ? '' : scope.db,
		table: scope.level === 'table' ? scope.table : '',
		sqlquery: s.sql
	}));
}

const flag = z
	.union([z.literal('1'), z.literal('0'), z.literal('on'), z.literal('')])
	.optional()
	.transform((v) => v === '1' || v === 'on');

const runForm = z.object({
	sql_query: z.string().max(MAX_QUERY_LENGTH),
	pos: z.coerce.number().int().min(0).max(2_000_000_000).default(0),
	single: flag,
	explain: z.enum(['', 'traditional', 'tree']).default(''),
	show_query: flag,
	retain_query_box: flag,
	rollback: flag,
	fk_checks: flag,
	profiling: flag,
	continue_on_error: flag,
	delimiter: z.string().max(16).regex(/^\S*$/).default(';')
});

export async function runSqlAction(
	{ request, locals }: Pick<RequestEvent, 'request' | 'locals'>,
	scope: SqlScope
) {
	const raw = await request.formData();
	const entries = Object.fromEntries([...raw.entries()].map(([k, v]) => [k, String(v)]));
	// Unchecked checkboxes are absent from a native form post; re-runs send every option explicitly.
	const parsed = runForm.safeParse(entries);
	if (!parsed.success) return fail(400, { error: 'Invalid request.' });
	const f = parsed.data;
	if (f.sql_query.trim() === '') return fail(400, { error: 'No SQL query was provided.' });

	const config = locals.config;
	const dbi = await locals.dbi;
	const conn = await locals.db;
	const result = await runScript(conn, f.sql_query, {
		db: scope.level === 'server' ? null : scope.db,
		delimiter: f.delimiter || ';',
		noSplit: f.single,
		continueOnError: f.continue_on_error,
		rollback: f.rollback,
		foreignKeyChecks: f.fk_checks,
		profiling: f.profiling,
		pos: f.pos,
		maxRows: config.MaxRows,
		explain: f.explain || null,
		rowKeys: createRowKeyResolver(dbi, getSecret(config.blowfish_secret))
	});

	await attachTransforms(locals, result);
	if (!f.single) await recordHistory(locals, historyEntries(scope, result));

	const options: SqlRunOptions = {
		showQuery: f.show_query,
		retainQueryBox: f.retain_query_box,
		rollback: f.rollback,
		foreignKeyChecks: f.fk_checks,
		profiling: f.profiling,
		continueOnError: f.continue_on_error,
		delimiter: f.delimiter || ';'
	};
	return {
		run: {
			result,
			options,
			sqlQuery: f.sql_query,
			refill: f.show_query || f.retain_query_box
		} satisfies SqlRunResult
	};
}
