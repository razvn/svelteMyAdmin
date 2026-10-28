/**
 * Header sorting for the SQL page: only for a simple single-table SELECT the ORDER BY clause can be
 * rewritten safely. Pure and client-safe.
 */
import type { Sort } from '#lib/table/sort.ts';
import { escapeId } from './escape.ts';
import { identName, significant, tokenize, type Token } from './tokens.ts';

export interface SimpleSelect {
	db: string | null;
	table: string;
	/** Single-column ORDER BY currently applied (null for none or complex ones). */
	sort: Sort | null;
	/** Range of the existing `ORDER BY ...` clause. */
	orderBy: { start: number; end: number } | null;
	/** Where a new ORDER BY goes. */
	insertAt: number;
}

const CLAUSE_END = new Set(['LIMIT', 'FOR', 'LOCK', 'PROCEDURE', 'INTO']);
const AFTER_TABLE = new Set(['WHERE', 'GROUP', 'HAVING', 'ORDER', 'WINDOW', ...CLAUSE_END]);

/** Parses `SELECT ... FROM [db.]table [[AS] alias] [WHERE|GROUP|HAVING|ORDER|LIMIT ...]`, else null. */
export function analyzeSimpleSelect(sql: string): SimpleSelect | null {
	const sig = significant(tokenize(sql));
	if (!sig.length || sig[0].upper !== 'SELECT') return null;
	const top = sig.filter((t) => t.depth === 0);
	if (top.some((t) => ['UNION', 'INTERSECT', 'EXCEPT', 'JOIN', 'INTO'].includes(t.upper))) {
		return null;
	}
	const fromAt = top.findIndex((t) => t.upper === 'FROM');
	if (fromAt < 0) return null;

	let i = fromAt + 1;
	const first = top[i];
	if (!first || (first.type !== 'word' && first.type !== 'quoted')) return null;
	let db: string | null = null;
	let table = identName(first);
	i++;
	if (top[i]?.text === '.') {
		const t = top[i + 1];
		if (!t || (t.type !== 'word' && t.type !== 'quoted')) return null;
		db = table;
		table = identName(t);
		i += 2;
	}
	if (top[i]?.upper === 'AS') i++;
	const alias = top[i];
	if (
		alias &&
		(alias.type === 'word' || alias.type === 'quoted') &&
		!AFTER_TABLE.has(alias.upper)
	) {
		i++;
	}
	const after = top[i];
	if (after && !AFTER_TABLE.has(after.upper)) return null;

	// ORDER BY range
	const rest = top.slice(i);
	const orderAt = rest.findIndex((t, k) => t.upper === 'ORDER' && rest[k + 1]?.upper === 'BY');
	const endTok: Token | undefined = rest.find((t, k) => k > orderAt && CLAUSE_END.has(t.upper));
	const lastEnd = sig[sig.length - 1].end;
	const lockOrLimit = rest.find((t) => CLAUSE_END.has(t.upper));
	const insertAt = lockOrLimit ? lockOrLimit.start : lastEnd;

	let orderBy: SimpleSelect['orderBy'] = null;
	let sort: Sort | null = null;
	if (orderAt >= 0) {
		const start = rest[orderAt].start;
		const end = endTok ? endTok.start : lastEnd;
		orderBy = { start, end };
		const items = rest.filter((t) => t.start >= rest[orderAt + 1].end && t.end <= end);
		// `col [ASC|DESC]` or `tbl.col [ASC|DESC]`
		const words = items.map((t) => t);
		const dirTok =
			words.at(-1)?.upper === 'ASC' || words.at(-1)?.upper === 'DESC' ? words.pop() : null;
		const simple =
			(words.length === 1 && words[0].type !== 'punct') ||
			(words.length === 3 && words[1].text === '.' && words[2].type !== 'punct');
		if (simple && !words.some((t) => t.text === ',')) {
			sort = {
				column: identName(words[words.length - 1]),
				dir: dirTok?.upper === 'DESC' ? 'desc' : 'asc'
			};
		}
	}
	return { db, table, sort, orderBy, insertAt };
}

/** Join SQL pieces with a space, or a newline when the left piece ends in a `-- comment`. */
function joinSql(...parts: string[]): string {
	let out = '';
	for (const raw of parts) {
		const part = out === '' ? raw.trimEnd() : raw.trim();
		if (!part) continue;
		if (out === '') {
			out = part;
			continue;
		}
		const last = tokenize(out).at(-1);
		out += (last?.type === 'comment' && !last.text.startsWith('/*') ? '\n' : ' ') + part;
	}
	return out;
}

/** The query with its ORDER BY replaced (or removed for `null`), or null when not a simple SELECT. */
export function applySort(sql: string, sort: Sort | null): string | null {
	const a = analyzeSimpleSelect(sql);
	if (!a) return null;
	const clause = sort
		? `ORDER BY ${escapeId(sort.column)} ${sort.dir === 'desc' ? 'DESC' : 'ASC'}`
		: '';
	if (a.orderBy) {
		return joinSql(sql.slice(0, a.orderBy.start), clause, sql.slice(a.orderBy.end));
	}
	if (!clause) return sql;
	return joinSql(sql.slice(0, a.insertAt), clause, sql.slice(a.insertAt));
}

/**
 * Can the result column named `name` be used in ORDER BY? Real columns (also aliased) and plain
 * aliases yes; unaliased expressions (`COUNT(*)`) no.
 */
export function isSortableField(name: string, orgName: string): boolean {
	return orgName !== '' || /^[A-Za-z_][A-Za-z0-9_$]*$/.test(name);
}
