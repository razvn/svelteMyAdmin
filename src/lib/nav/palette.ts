/** Ranking for the command palette (Ctrl/Cmd+K). */

export type PaletteKind = 'database' | 'table' | 'view' | 'tab' | 'page';

export interface PaletteItem {
	id: string;
	kind: PaletteKind;
	label: string;
	/** Secondary text (database of a table, tab context, ...). */
	description?: string;
	href: string;
}

const KIND_ORDER: Record<PaletteKind, number> = {
	database: 0,
	table: 1,
	view: 2,
	tab: 3,
	page: 4
};

/** Score of one query token against a text; 0 means no match. Higher is better. */
export function scoreToken(token: string, text: string): number {
	const t = text.toLowerCase();
	const q = token.toLowerCase();
	if (q === '') return 1;
	if (t === q) return 1000;
	if (t.startsWith(q)) return 800 - Math.min(t.length - q.length, 100);
	const idx = t.indexOf(q);
	if (idx > 0) {
		const boundary = /[\s_\-.:/]/.test(t[idx - 1]);
		return (boundary ? 600 : 400) - Math.min(idx, 100);
	}
	// subsequence (fuzzy): every character in order
	let pos = 0;
	let gaps = 0;
	let last = -1;
	for (const ch of q) {
		const found = t.indexOf(ch, pos);
		if (found === -1) return 0;
		if (last !== -1) gaps += found - last - 1;
		last = found;
		pos = found + 1;
	}
	return Math.max(1, 200 - gaps * 5 - t.length);
}

/** Score of an item: every whitespace-separated token must match its label or description. */
export function scoreItem(item: PaletteItem, query: string): number {
	const tokens = query.split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return 1;
	let total = 0;
	for (const token of tokens) {
		const own = scoreToken(token, item.label);
		const desc = item.description ? scoreToken(token, item.description) / 4 : 0;
		const best = Math.max(own, desc);
		if (best === 0) return 0;
		total += best;
	}
	return total;
}

/** Items matching `query`, best first (ties: kind order, then label). Empty query keeps order. */
export function rankItems(items: PaletteItem[], query: string, limit = 50): PaletteItem[] {
	if (query.trim() === '') return items.slice(0, limit);
	return items
		.map((item, index) => ({ item, index, score: scoreItem(item, query) }))
		.filter((x) => x.score > 0)
		.sort(
			(a, b) =>
				b.score - a.score ||
				KIND_ORDER[a.item.kind] - KIND_ORDER[b.item.kind] ||
				a.item.label.localeCompare(b.item.label) ||
				a.index - b.index
		)
		.slice(0, limit)
		.map((x) => x.item);
}
