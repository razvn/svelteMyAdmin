/** Hidden navigation items (Navigation.php, pma__navigationhiding). */
import type { DbChildren } from '#lib/nav/types.ts';

export type HiddenType = 'table' | 'view' | 'function' | 'procedure' | 'event';

export const HIDDEN_TYPES: readonly HiddenType[] = [
	'table',
	'view',
	'function',
	'procedure',
	'event'
];

export interface HiddenItem {
	name: string;
	type: HiddenType;
}

const KEYS = {
	table: 'tables',
	view: 'views',
	function: 'functions',
	procedure: 'procedures',
	event: 'events'
} as const;

/** Remove hidden items from the lazily loaded children of a database. */
export function applyHidden(children: DbChildren, hidden: readonly HiddenItem[]): DbChildren {
	const out: DbChildren = { ...children };
	for (const type of HIDDEN_TYPES) {
		const names = new Set(hidden.filter((h) => h.type === type).map((h) => h.name));
		if (names.size === 0) continue;
		out[KEYS[type]] = children[KEYS[type]].filter((n) => !names.has(n));
	}
	return out;
}
