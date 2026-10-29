/**
 * Shared load/action preamble of the account editor pages: the edited account from `?username=&hostname=`,
 * the server facts and the capability check.
 */
import { redirect } from '@sveltejs/kit';
import type { Account, PrivServer } from '#lib/sql/privileges/index.ts';
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import { readAccount, type AccountDetails } from './accounts.ts';
import { getCapabilities, getPrivServer, type Capabilities } from './context.ts';
import { accountQuerySchema } from './forms.ts';
import { resolveAccount } from './scoped.ts';

export function accountFromUrl(url: URL): Account | null {
	const p = accountQuerySchema.safeParse({
		username: url.searchParams.get('username'),
		hostname: url.searchParams.get('hostname')
	});
	return p.success ? { user: p.data.username, host: p.data.hostname } : null;
}

export interface EditContext {
	dbi: DatabaseInterface;
	server: PrivServer;
	caps: Capabilities;
	/** The edited account (a MariaDB role carries `noHost`). */
	account: Account;
}

export async function editContext(locals: App.Locals, url: URL): Promise<EditContext> {
	const acc = accountFromUrl(url);
	if (!acc) redirect(303, '/server/privileges');
	const dbi = await locals.dbi;
	const [server, caps] = await Promise.all([getPrivServer(dbi), getCapabilities(dbi)]);
	return { dbi, server, caps, account: resolveAccount(server, acc) };
}

export type EditBase =
	| { state: 'denied' }
	| { state: 'missing'; error: string }
	| { state: 'ok'; details: AccountDetails };

/** Permission + existence check shared by every tab. */
export async function loadEditBase(ctx: EditContext): Promise<EditBase> {
	if (!ctx.caps.isGrantUser && !ctx.caps.isSuperUser) return { state: 'denied' };
	const details = await readAccount(ctx.dbi, ctx.server, ctx.account);
	if (!details.properties.exists && details.grantsError) {
		return { state: 'missing', error: details.grantsError };
	}
	return { state: 'ok', details };
}
