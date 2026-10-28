import { createContext } from 'svelte';
import type { DbChildren } from '#lib/nav/types.ts';

export type ChildrenFetcher = (db: string) => Promise<DbChildren>;
export type LoadStatus = 'loading' | 'ready' | 'error';

/** Default fetcher: the lazy-loading JSON endpoint. */
export const fetchDbChildren: ChildrenFetcher = async (db) => {
	const res = await fetch(`/api/navigation/${encodeURIComponent(db)}`, {
		headers: { accept: 'application/json' }
	});
	if (!res.ok) throw new Error(`Navigation request failed (${res.status})`);
	return (await res.json()) as DbChildren;
};

/**
 * Browser-side state of the navigation tree: which databases are expanded and the lazily
 * loaded children. One instance per app shell (shared through context, never module level).
 */
export class NavState {
	children = $state<Record<string, DbChildren>>({});
	status = $state<Record<string, LoadStatus>>({});
	expanded = $state<Record<string, boolean>>({});
	readonly #fetch: ChildrenFetcher;

	constructor(fetcher: ChildrenFetcher = fetchDbChildren) {
		this.#fetch = fetcher;
	}

	isExpanded(db: string): boolean {
		return this.expanded[db] === true;
	}

	async expand(db: string): Promise<void> {
		this.expanded[db] = true;
		await this.load(db);
	}

	collapse(db: string): void {
		this.expanded[db] = false;
	}

	async toggle(db: string): Promise<void> {
		if (this.isExpanded(db)) this.collapse(db);
		else await this.expand(db);
	}

	/** Load the children of a database unless already loaded/loading (or `force`). */
	async load(db: string, force = false): Promise<void> {
		if (!force && (this.status[db] === 'ready' || this.status[db] === 'loading')) return;
		this.status[db] = 'loading';
		try {
			this.children[db] = await this.#fetch(db);
			this.status[db] = 'ready';
		} catch {
			this.status[db] = 'error';
		}
	}

	/** "Reload navigation": refetch every expanded database. */
	async reload(): Promise<void> {
		const open = Object.keys(this.expanded).filter((db) => this.expanded[db]);
		this.children = {};
		this.status = {};
		await Promise.all(open.map((db) => this.load(db, true)));
	}
}

export const [getNavState, setNavState] = createContext<NavState>();
