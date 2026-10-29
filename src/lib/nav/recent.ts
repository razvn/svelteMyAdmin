/**
 * Recent / favorite table lists (RecentFavoriteTable.php). The stored value is the JSON text phpMyAdmin
 * writes to `pma__recent.tables` / `pma__favorite.tables`: `[{"db":"x","table":"y"}, ...]`, newest first.
 */
export interface TableRef {
	db: string;
	table: string;
}

export type ListKind = 'recent' | 'favorite';

const same = (a: TableRef, b: TableRef) => a.db === b.db && a.table === b.table;

/** Parse the stored JSON; anything that is not a list of `{db, table}` strings is dropped. */
export function parseTables(json: unknown): TableRef[] {
	if (typeof json !== 'string' || json === '') return [];
	let data: unknown;
	try {
		data = JSON.parse(json);
	} catch {
		return [];
	}
	// PHP encodes a list with holes (after unset) as an object keyed by index.
	const items = Array.isArray(data)
		? data
		: data && typeof data === 'object'
			? Object.values(data as Record<string, unknown>)
			: [];
	const out: TableRef[] = [];
	for (const item of items) {
		if (!item || typeof item !== 'object') continue;
		const { db, table } = item as Record<string, unknown>;
		if (typeof db !== 'string' || typeof table !== 'string') continue;
		if (!out.some((x) => same(x, { db, table }))) out.push({ db, table });
	}
	return out;
}

/** Same shape as PHP's `json_encode` of the list. */
export function serializeTables(list: readonly TableRef[]): string {
	return JSON.stringify(list.map((t) => ({ db: t.db, table: t.table })));
}

/** Newest first, deduplicated, cut to `max` (`RecentFavoriteTable::add` + `trim`). */
export function addTable(list: readonly TableRef[], ref: TableRef, max: number): TableRef[] {
	const limit = Math.max(0, Math.floor(max));
	if (list.length > 0 && same(list[0], ref)) return list.slice(0, limit);
	return [{ db: ref.db, table: ref.table }, ...list.filter((x) => !same(x, ref))].slice(0, limit);
}

export function removeTable(list: readonly TableRef[], ref: TableRef): TableRef[] {
	return list.filter((x) => !same(x, ref));
}

export function hasTable(list: readonly TableRef[], ref: TableRef): boolean {
	return list.some((x) => same(x, ref));
}
