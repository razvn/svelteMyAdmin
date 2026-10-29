/**
 * Tabs of the user account editor (`/server/privileges/edit?username=&hostname=`), the same sections as
 * phpMyAdmin's "Edit privileges" page. Only `global` is implemented; the others are placeholders that the
 * follow-up phases enable (`available: true`) once their route exists.
 *
 * Routes: `global` is `/server/privileges/edit`, every other tab lives below it
 * (`/server/privileges/edit/database`, `.../table`, `.../column`, `.../routine`, `.../login`).
 */
import type { Account } from '#lib/sql/privileges/index.ts';

export interface AccountTab {
	id: 'global' | 'database' | 'table' | 'column' | 'routine' | 'login';
	label: string;
	/** Has a page? Placeholders are rendered disabled. */
	available: boolean;
}

export const ACCOUNT_TABS: readonly AccountTab[] = [
	{ id: 'global', label: 'Global', available: true },
	{ id: 'database', label: 'Database', available: false },
	{ id: 'table', label: 'Table', available: false },
	{ id: 'column', label: 'Column', available: false },
	{ id: 'routine', label: 'Routine', available: false },
	{ id: 'login', label: 'Login information', available: false }
];

/** Query string that identifies the edited account. */
export function accountQuery(account: Account): string {
	return new URLSearchParams({ username: account.user, hostname: account.host }).toString();
}

export function accountTabHref(tab: AccountTab['id'], account: Account): string {
	const base = tab === 'global' ? '/server/privileges/edit' : `/server/privileges/edit/${tab}`;
	return `${base}?${accountQuery(account)}`;
}
