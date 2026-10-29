import { N_ } from '#lib/i18n/translator.ts';
import { createContext } from 'svelte';
import { hasTable, type TableRef } from '#lib/nav/recent.ts';

export interface QuickData {
	recent: TableRef[];
	favorites: TableRef[];
}

export type QuickFetcher = () => Promise<QuickData>;
export type FavoriteSender = (
	ref: TableRef,
	favorite: boolean
) => Promise<{ result: 'added' | 'removed' | 'full'; favorites: TableRef[]; message?: string }>;

const fetchQuick: QuickFetcher = async () => {
	const res = await fetch('/api/navigation/quick', { headers: { accept: 'application/json' } });
	if (!res.ok) throw new Error(`Request failed (${res.status})`);
	return (await res.json()) as QuickData;
};

const sendFavorite: FavoriteSender = async (ref, favorite) => {
	const res = await fetch('/api/navigation/favorite', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ ...ref, favorite })
	});
	if (!res.ok) throw new Error(`Request failed (${res.status})`);
	return await res.json();
};

/**
 * Browser-side state of the sidebar "Recent" / "Favorites" lists and of the star buttons.
 * One instance per app shell (shared through context, never module level).
 */
export class QuickAccess {
	recent = $state<TableRef[]>([]);
	favorites = $state<TableRef[]>([]);
	/** Last message from the server (e.g. the favorites limit was reached). */
	message = $state('');
	readonly #fetch: QuickFetcher;
	readonly #send: FavoriteSender;

	constructor(fetcher: QuickFetcher = fetchQuick, sender: FavoriteSender = sendFavorite) {
		this.#fetch = fetcher;
		this.#send = sender;
	}

	isFavorite(db: string, table: string): boolean {
		return hasTable(this.favorites, { db, table });
	}

	async refresh(): Promise<void> {
		try {
			const data = await this.#fetch();
			this.recent = data.recent;
			this.favorites = data.favorites;
		} catch {
			// keep the previous lists
		}
	}

	async toggleFavorite(db: string, table: string): Promise<void> {
		const ref = { db, table };
		this.message = '';
		try {
			const res = await this.#send(ref, !this.isFavorite(db, table));
			this.favorites = res.favorites;
			if (res.message) this.message = res.message;
		} catch {
			this.message = N_('Could not update the favorite tables.');
		}
	}
}

export const [getQuickAccess, setQuickAccess] = createContext<QuickAccess>();
