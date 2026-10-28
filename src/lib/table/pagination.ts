/** Browse pagination math (Results::getTableNavigation / SqlController `pos` + `session_max_rows`). */

export const ROWS_OPTIONS = [25, 50, 100, 250, 500] as const;
/** "Show all" never returns more rows than this. */
export const SHOW_ALL_CAP = 5000;
/** phpMyAdmin offers "Show all" without `ShowAll` only for results up to this size. */
export const SHOW_ALL_FREE_LIMIT = 500;

export type RowsPerPage = number | 'all';

/** Row count choices, always including the configured `MaxRows`. */
export function rowsOptions(maxRows: number): number[] {
	return [...new Set<number>([...ROWS_OPTIONS, maxRows])].sort((a, b) => a - b);
}

/** Parse the `rows` query value (`50`, `all`); anything else falls back to `fallback`. */
export function parseRows(value: string | null | undefined, fallback: RowsPerPage): RowsPerPage {
	if (value === 'all') return 'all';
	if (value && /^\d+$/.test(value)) {
		const n = Number(value);
		if (n >= 1 && n <= SHOW_ALL_CAP) return n;
	}
	return fallback;
}

/** Is "Show all" offered? (config `ShowAll`, or a small result) */
export function canShowAll(total: number, showAllConfig: boolean): boolean {
	return showAllConfig || total <= SHOW_ALL_FREE_LIMIT;
}

/** Effective LIMIT size. */
export function pageSize(rows: RowsPerPage): number {
	return rows === 'all' ? SHOW_ALL_CAP : rows;
}

export interface PageInfo {
	/** 0-based offset of the first row of the page (clamped into the result). */
	pos: number;
	size: number;
	page: number;
	pages: number;
	/** 1-based inclusive range of rows displayed; both 0 when there are none. */
	from: number;
	to: number;
	prevPos: number | null;
	nextPos: number | null;
	firstPos: number;
	lastPos: number;
}

/** `pos` is snapped to a page boundary and clamped into the result. */
export function paginate(pos: number, size: number, total: number): PageInfo {
	const pages = Math.max(1, Math.ceil(total / size));
	const lastPos = (pages - 1) * size;
	const clamped = total === 0 ? 0 : Math.min(Math.max(0, Math.floor(pos / size) * size), lastPos);
	const count = Math.max(0, Math.min(size, total - clamped));
	return {
		pos: clamped,
		size,
		page: Math.floor(clamped / size) + 1,
		pages,
		from: count === 0 ? 0 : clamped + 1,
		to: count === 0 ? 0 : clamped + count,
		prevPos: clamped > 0 ? clamped - size : null,
		nextPos: clamped + size < total ? clamped + size : null,
		firstPos: 0,
		lastPos
	};
}

/**
 * Page numbers offered by the page selector (Util::pageselector): all of them for up to 200
 * pages, else the first/last few, the neighbourhood of the current page and sparse jumps.
 */
export function pageChoices(pages: number, current: number): number[] {
	if (pages < 200) return Array.from({ length: pages }, (_, i) => i + 1);
	const set = new Set<number>();
	for (let i = 1; i <= 5; i++) set.add(i);
	for (let i = pages - 5; i <= pages; i++) set.add(i);
	for (let i = current - 10; i <= current + 10; i++) if (i >= 1 && i <= pages) set.add(i);
	const step = Math.max(1, Math.floor(pages / 20));
	for (let i = 1; i <= pages; i += step) set.add(i);
	return [...set].sort((a, b) => a - b);
}
