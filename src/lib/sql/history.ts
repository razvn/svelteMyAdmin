/** Query history entries and the pure parts of recording them (Relation::setHistory). */

export interface HistoryEntry {
	db: string;
	table: string;
	sqlquery: string;
	/** `YYYY-MM-DD HH:MM:SS` (server time), '' when unknown. */
	timevalue: string;
}

/** Is the statement worth recording? Empty ones and ones longer than the displayed-SQL limit are not. */
export function shouldRecord(sql: string, maxChars: number): boolean {
	const text = sql.trim();
	if (text === '') return false;
	return maxChars <= 0 || Array.from(text).length <= maxChars;
}

/** Append `entry` (newest last) and drop the oldest entries above `max` (session history). */
export function pushHistory(
	list: readonly HistoryEntry[],
	entry: HistoryEntry,
	max: number
): HistoryEntry[] {
	const next = [...list, entry];
	const limit = Math.max(1, max);
	return next.length > limit ? next.slice(next.length - limit) : next;
}

/** Case-insensitive filter over query text, database and table. */
export function filterHistory<T extends Pick<HistoryEntry, 'db' | 'table' | 'sqlquery'>>(
	list: readonly T[],
	term: string
): T[] {
	const t = term.trim().toLowerCase();
	if (t === '') return [...list];
	return list.filter((e) => `${e.sqlquery}\n${e.db}\n${e.table}`.toLowerCase().includes(t));
}
