/**
 * Tabs of the user account editor (`/server/privileges/edit?username=&hostname=`), the same sections as
 * phpMyAdmin's "Edit privileges" page plus a Roles tab on servers that have roles.
 *
 * Routes: `global` is `/server/privileges/edit`, every other tab lives below it
 * (`/server/privileges/edit/database`, `.../table`, `.../routine`, `.../login`, `.../roles`).
 * `column` has no page of its own: in phpMyAdmin column privileges are a section of the table editor, so the
 * tab opens `.../table#column-privileges`.
 */
import { supportsRoles, type Account, type PrivServer } from '#lib/sql/privileges/index.ts';

export interface AccountTab {
	id: 'global' | 'database' | 'table' | 'column' | 'routine' | 'login' | 'roles';
	label: string;
	/** Has a page? Placeholders are rendered disabled. */
	available: boolean;
}

export const ACCOUNT_TABS: readonly AccountTab[] = [
	{ id: 'global', label: 'Global', available: true },
	{ id: 'database', label: 'Database', available: true },
	{ id: 'table', label: 'Table', available: true },
	{ id: 'column', label: 'Column', available: true },
	{ id: 'routine', label: 'Routine', available: true },
	{ id: 'roles', label: 'Roles', available: true },
	{ id: 'login', label: 'Login information', available: true }
];

/** The tabs shown for a server (Roles only where `CREATE ROLE` exists). */
export function accountTabsFor(server?: PrivServer): readonly AccountTab[] {
	return server && !supportsRoles(server) ? ACCOUNT_TABS.filter((t) => t.id !== 'roles') : ACCOUNT_TABS;
}

/** Query string that identifies the edited account. */
export function accountQuery(account: Account): string {
	return new URLSearchParams({ username: account.user, hostname: account.host }).toString();
}

export function accountTabHref(tab: AccountTab['id'], account: Account): string {
	if (tab === 'global') return `/server/privileges/edit?${accountQuery(account)}`;
	if (tab === 'column') return `/server/privileges/edit/table?${accountQuery(account)}#column-privileges`;
	return `/server/privileges/edit/${tab}?${accountQuery(account)}`;
}
