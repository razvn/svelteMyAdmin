/** Load data of the Database / Table "Privileges" pages: users having access, ready for the list component. */
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import { describeAccess, type PrivServer } from '#lib/sql/privileges/index.ts';
import { getCapabilities, getPrivServer } from './context.ts';
import { encodeAccount } from './forms.ts';
import { listUsersWithAccess } from './scoped.ts';

export interface AccessViewRow {
	user: string;
	host: string;
	/** `selected_usr` style value for the export form. */
	value: string;
	type: string;
	routine?: string;
	privileges: string;
	grantOption: boolean;
	editHref: string;
}

export async function loadAccessView(
	dbi: DatabaseInterface,
	db: string,
	table?: string
): Promise<
	| { state: 'denied'; isGrantUser: boolean }
	| { state: 'ok'; isGrantUser: boolean; server: PrivServer; rows: AccessViewRow[] }
> {
	const [server, caps] = await Promise.all([getPrivServer(dbi), getCapabilities(dbi)]);
	if (!caps.isSuperUser) return { state: 'denied', isGrantUser: caps.isGrantUser };
	const rows: AccessViewRow[] = [];
	for (const u of await listUsersWithAccess(dbi, server, db, table)) {
		for (const e of u.entries) {
			const q = new URLSearchParams({ username: u.user, hostname: u.host });
			let href = `/server/privileges/edit?${q}`;
			if (e.type === 'database-specific' || e.type === 'wildcard') {
				q.set('dbname', e.db);
				href = `/server/privileges/edit/database?${q}`;
			} else if (e.type === 'table-specific') {
				q.set('dbname', db);
				q.set('tablename', e.table ?? '');
				href = `/server/privileges/edit/table?${q}`;
			} else if (e.type === 'routine') {
				q.set('dbname', db);
				q.set('routine', `${e.routineType}|${e.routine}`);
				href = `/server/privileges/edit/routine?${q}`;
			}
			rows.push({
				user: u.user,
				host: u.host,
				value: encodeAccount({ user: u.user, host: u.host }),
				type: e.type,
				routine: e.routine,
				privileges: describeAccess(e, server),
				grantOption: e.grantOption,
				editHref: href
			});
		}
	}
	return { state: 'ok', isGrantUser: caps.isGrantUser, server, rows };
}
