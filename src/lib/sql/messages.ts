/** phpMyAdmin-style result messages (client-safe, pure). */
import { formatNumber } from '#lib/format.ts';
import { N_, SOURCE_TRANSLATOR, type Translator } from '#lib/i18n/translator.ts';

/** What the message helpers need from `useI18n()`; defaults to English. */
export interface MessageI18n {
	t: Translator['t'];
	tn: Translator['tn'];
	fmt: { number: (v: number | string | null | undefined) => string };
}
const ENGLISH: MessageI18n = {
	t: SOURCE_TRANSLATOR.t,
	tn: SOURCE_TRANSLATOR.tn,
	fmt: { number: (v) => formatNumber(v) }
};

/** Msgids: translate with `t()` where displayed. */
export const EMPTY_RESULT_MESSAGE = N_('MySQL returned an empty result set (i.e. zero rows).');
export const SUCCESS_MESSAGE = N_('Your SQL query has been executed successfully.');

/** `0.0123` (PHP prints 4 decimals). */
export const formatSeconds = (ms: number): string => (ms / 1000).toFixed(4);

export const queryTook = (ms: number, i: MessageI18n = ENGLISH): string =>
	i.t('Query took {seconds} seconds.', { seconds: formatSeconds(ms) });

export function affectedRowsMessage(n: number, i: MessageI18n = ENGLISH): string {
	return i.tn('{n} row affected.', '{n} rows affected.', n, { n: i.fmt.number(n) });
}

/** `Showing rows 0 - 24 (100 total, Query took 0.0003 seconds.)`; `from`/`to` are 0-based like LIMIT. */
export function showingRowsMessage(
	o: {
		from: number;
		to: number;
		total: number | null;
		ms: number;
	},
	i: MessageI18n = ENGLISH
): string {
	const range = i.t('Showing rows {from} - {to}', {
		from: i.fmt.number(o.from),
		to: i.fmt.number(o.to)
	});
	const took = queryTook(o.ms, i);
	return o.total === null
		? i.t('{range} ({took})', { range, took })
		: i.t('{range} ({total} total, {took})', { range, total: i.fmt.number(o.total), took });
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
