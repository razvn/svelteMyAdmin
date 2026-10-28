/**
 * Appending `LIMIT pos, rows` to a SELECT the way phpMyAdmin does for browsing arbitrary queries.
 * Queries that already have a top-level LIMIT, or that must not get one (`INTO`), are left alone.
 */
import { classifyStatement } from './classify.ts';
import { significant, tokenize } from './tokens.ts';

export interface SelectAnalysis {
	/** Row-returning SELECT (SELECT / WITH ... SELECT / parenthesised / TABLE / VALUES). */
	isSelect: boolean;
	hasLimit: boolean;
	/** `SELECT ... INTO` (no result set). */
	hasInto: boolean;
	hasUnion: boolean;
	/** Offset where a LIMIT must be inserted (before FOR UPDATE / LOCK IN SHARE MODE / PROCEDURE). */
	lockStart: number | null;
	/** End offset of the last non-comment token. */
	lastEnd: number;
}

export function analyzeSelect(sql: string): SelectAnalysis {
	const sig = significant(tokenize(sql));
	const top = sig.filter((t) => t.depth === 0 && t.type === 'word');
	const a: SelectAnalysis = {
		isSelect: classifyStatement(sql) === 'select',
		hasLimit: top.some((t) => t.upper === 'LIMIT'),
		hasInto: top.some((t) => t.upper === 'INTO'),
		hasUnion: top.some((t) => ['UNION', 'INTERSECT', 'EXCEPT'].includes(t.upper)),
		lockStart: null,
		lastEnd: sig.length ? sig[sig.length - 1].end : 0
	};
	for (let i = 0; i < sig.length; i++) {
		const t = sig[i];
		if (t.depth !== 0 || t.type !== 'word') continue;
		const next = sig[i + 1]?.upper;
		if (
			(t.upper === 'FOR' && (next === 'UPDATE' || next === 'SHARE')) ||
			(t.upper === 'LOCK' && next === 'IN') ||
			t.upper === 'PROCEDURE'
		) {
			a.lockStart = t.start;
			break;
		}
	}
	return a;
}

/** Can the pagination add its own LIMIT? */
export function canPaginate(sql: string): boolean {
	const a = analyzeSelect(sql);
	return a.isSelect && !a.hasLimit && !a.hasInto;
}

export interface LimitResult {
	sql: string;
	appended: boolean;
}

export function appendLimit(sql: string, pos: number, rows: number): LimitResult {
	const a = analyzeSelect(sql);
	if (!a.isSelect || a.hasLimit || a.hasInto) return { sql, appended: false };
	const limit = `LIMIT ${Math.max(0, Math.trunc(pos))}, ${Math.max(1, Math.trunc(rows))}`;
	if (a.lockStart !== null) {
		return {
			sql: `${sql.slice(0, a.lockStart).trimEnd()} ${limit} ${sql.slice(a.lockStart)}`,
			appended: true
		};
	}
	// Inserted right after the last real token, so a trailing `-- comment` cannot swallow it.
	return { sql: `${sql.slice(0, a.lastEnd)} ${limit}${sql.slice(a.lastEnd)}`, appended: true };
}
