/**
 * Query history (Relation::setHistory / getHistory / purgeHistory).
 *
 * Every executed user statement goes into a capped in-memory list per login (phpMyAdmin keeps it in
 * `$_SESSION['sql_history']`). With `QueryHistoryDB` and the `history` table it is also written to
 * `pma__history`, which is then the source of the list.
 */
import { withRepo } from '#lib/server/storage/index.ts';
import { pushHistory, shouldRecord, type HistoryEntry } from '#lib/sql/history.ts';

export type { HistoryEntry };

const MAX_LOGINS = 500;
const memory = new Map<string, HistoryEntry[]>();

const memoryKey = (locals: App.Locals) =>
	`${locals.serverIndex}\n${locals.session?.user ?? ''}\n${locals.session?.host ?? ''}:${locals.session?.port ?? 0}`;

function nowText(): string {
	return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

export {
	clearHistoryRows,
	insertHistoryRow,
	purgeHistoryRows,
	selectHistoryRows
} from '#lib/server/storage/mysql/history.ts';

// ---- entry points ------------------------------------------------------------------------------

/** Record executed statements (oldest first). Never throws. */
export async function recordHistory(
	locals: App.Locals,
	entries: { db: string; table: string; sqlquery: string }[]
): Promise<void> {
	try {
		const config = locals.config;
		const max = config.QueryHistoryMax;
		// Only the newest `max` entries can survive the purge anyway.
		const keep = entries
			.filter((e) => shouldRecord(e.sqlquery, config.MaxCharactersInDisplayedSQL))
			.map((e) => ({ ...e, sqlquery: e.sqlquery.trim() }))
			.slice(-Math.max(1, max));
		if (keep.length === 0) return;

		const key = memoryKey(locals);
		let list = memory.get(key) ?? [];
		for (const e of keep) list = pushHistory(list, { ...e, timevalue: nowText() }, max);
		memory.delete(key);
		memory.set(key, list);
		if (memory.size > MAX_LOGINS) memory.delete(memory.keys().next().value as string);

		if (!config.QueryHistoryDB) return;
		const user = locals.session?.user ?? '';
		await withRepo(locals, 'history', async (repo) => {
			for (const e of keep) {
				await repo.insert({ username: user, ...e });
			}
			await repo.purge(user, max);
		});
	} catch {
		// history must never break running a query
	}
}

/** Newest first. */
export async function getHistory(locals: App.Locals): Promise<HistoryEntry[]> {
	const config = locals.config;
	if (config.QueryHistoryDB) {
		const user = locals.session?.user ?? '';
		const stored = await withRepo(locals, 'history', (repo) =>
			repo.select(user, config.QueryHistoryMax)
		);
		if (stored) return stored;
	}
	return [...(memory.get(memoryKey(locals)) ?? [])].reverse();
}

export async function clearHistory(locals: App.Locals): Promise<void> {
	memory.delete(memoryKey(locals));
	if (!locals.config.QueryHistoryDB) return;
	const user = locals.session?.user ?? '';
	await withRepo(locals, 'history', (repo) => repo.clear(user));
}
