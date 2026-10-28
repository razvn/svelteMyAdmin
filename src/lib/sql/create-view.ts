/** CREATE VIEW statement from the "Create view" dialog (Controllers/View/CreateController.php). */
import { buildDefinerClause } from './definer.ts';
import { escapeId } from './escape.ts';

export const VIEW_ALGORITHMS = ['UNDEFINED', 'MERGE', 'TEMPTABLE'] as const;
export const VIEW_SECURITY = ['DEFINER', 'INVOKER'] as const;
export const VIEW_CHECK_OPTIONS = ['CASCADED', 'LOCAL'] as const;

export interface CreateViewForm {
	name: string;
	orReplace: boolean;
	algorithm: (typeof VIEW_ALGORITHMS)[number] | '';
	definer: string;
	sqlSecurity: (typeof VIEW_SECURITY)[number] | '';
	/** Comma separated column names ('' = the query's own). */
	columnNames: string;
	/** The SELECT. */
	as: string;
	withCheck: (typeof VIEW_CHECK_OPTIONS)[number] | '';
}

export type CreateViewResult = { sql: string; error: null } | { sql: ''; error: string };

/** Parts of a column list, trimmed and without empty entries. */
export const splitColumnNames = (text: string): string[] =>
	text
		.split(',')
		.map((c) => c.trim())
		.filter((c) => c !== '');

export function buildCreateView(f: CreateViewForm): CreateViewResult {
	const name = f.name.trim();
	if (name === '') return { sql: '', error: 'The view name must not be empty.' };
	const query = f.as.trim().replace(/;+\s*$/, '');
	if (query === '') return { sql: '', error: 'The view needs a SELECT statement.' };
	const definer = buildDefinerClause(f.definer);
	if (definer.error !== null) return { sql: '', error: definer.error };

	const parts = ['CREATE'];
	if (f.orReplace) parts.push('OR REPLACE');
	if (f.algorithm) parts.push(`ALGORITHM = ${f.algorithm}`);
	if (definer.clause) parts.push(definer.clause.trim());
	if (f.sqlSecurity) parts.push(`SQL SECURITY ${f.sqlSecurity}`);
	parts.push('VIEW', escapeId(name));
	const columns = splitColumnNames(f.columnNames);
	if (columns.length) parts.push(`(${columns.map(escapeId).join(', ')})`);
	parts.push('AS', query);
	if (f.withCheck) parts.push(`WITH ${f.withCheck} CHECK OPTION`);
	return { sql: parts.join(' '), error: null };
}
