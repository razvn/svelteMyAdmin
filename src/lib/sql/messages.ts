/** phpMyAdmin-style result messages (client-safe, pure). */
import { formatNumber } from '#lib/format.ts';

export const EMPTY_RESULT_MESSAGE = 'MySQL returned an empty result set (i.e. zero rows).';
export const SUCCESS_MESSAGE = 'Your SQL query has been executed successfully.';

/** `0.0123` (PHP prints 4 decimals). */
export const formatSeconds = (ms: number): string => (ms / 1000).toFixed(4);

export const queryTook = (ms: number): string => `Query took ${formatSeconds(ms)} seconds.`;

export function affectedRowsMessage(n: number): string {
	return `${formatNumber(n)} ${n === 1 ? 'row' : 'rows'} affected.`;
}

/** `Showing rows 0 - 24 (100 total, Query took 0.0003 seconds.)`; `from`/`to` are 0-based like LIMIT. */
export function showingRowsMessage(o: {
	from: number;
	to: number;
	total: number | null;
	ms: number;
}): string {
	const range = `Showing rows ${formatNumber(o.from)} - ${formatNumber(o.to)}`;
	const total = o.total === null ? '' : `${formatNumber(o.total)} total, `;
	return `${range} (${total}${queryTook(o.ms)})`;
}

/** `#1064 - You have an error...` */
export const errorMessage = (errno: number, message: string): string => `#${errno} - ${message}`;

/**
 * Location of the failing part in `sql` for syntax errors (`... near 'xyz' at line 1`), so the
 * statement can be shown with the offending text highlighted. null when not locatable.
 */
export function locateSyntaxError(
	sql: string,
	errno: number,
	message: string
): { start: number; end: number } | null {
	if (errno !== 1064) return null;
	const m = message.match(/near '([\s\S]*?)' at line \d+/);
	if (!m) return null;
	const frag = m[1];
	if (frag === '') return { start: sql.length, end: sql.length };
	const at = sql.lastIndexOf(frag);
	if (at < 0) return null;
	return { start: at, end: at + frag.length };
}

export interface TruncatedSql {
	text: string;
	truncated: boolean;
}

/** Shown statements are cut to `MaxCharactersInDisplayedSQL` (0 or less = never). */
export function truncateSql(sql: string, max: number): TruncatedSql {
	if (max <= 0 || sql.length <= max) return { text: sql, truncated: false };
	return { text: sql.slice(0, max), truncated: true };
}
