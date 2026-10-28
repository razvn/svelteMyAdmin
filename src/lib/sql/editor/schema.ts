import type { SQLNamespace } from '@codemirror/lang-sql';

/** table name -> column names (shape returned by `/api/sql/schema`, key `tables`). */
export type SqlSchema = Record<string, string[]>;

/** Drop empty/duplicate names so the completion list stays clean. */
export function normalizeSchema(schema: SqlSchema | null | undefined): SqlSchema {
	const out: SqlSchema = {};
	if (!schema) return out;
	for (const [table, cols] of Object.entries(schema)) {
		if (table === '') continue;
		out[table] = [...new Set(cols.filter((c) => c !== ''))];
	}
	return out;
}

/** Namespace for `@codemirror/lang-sql`: tables complete at top level, `t.` completes its columns. */
export function toSqlNamespace(schema: SqlSchema | null | undefined): SQLNamespace {
	return normalizeSchema(schema);
}

/** Parse the JSON returned by the schema endpoint; anything unexpected yields an empty schema. */
export function parseSchemaResponse(data: unknown): SqlSchema {
	if (typeof data !== 'object' || data === null) return {};
	const tables = (data as { tables?: unknown }).tables;
	if (typeof tables !== 'object' || tables === null) return {};
	const out: SqlSchema = {};
	for (const [table, cols] of Object.entries(tables)) {
		if (Array.isArray(cols)) out[table] = cols.filter((c): c is string => typeof c === 'string');
	}
	return normalizeSchema(out);
}
