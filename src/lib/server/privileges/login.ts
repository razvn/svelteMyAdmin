/**
 * Change login information / copy user account (Privileges::getDataForChangeOrCopyUser,
 * getDbSpecificPrivsQueriesForChangeOrCopyUser, getDataForDeleteUsers). The statements come from the pure
 * planner `planChangeLogin`; deleting the old account only happens when every copy statement succeeded.
 */
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import { planChangeLogin, type PrivServer } from '#lib/sql/privileges/index.ts';
import { readAccount, readAccountCredentials } from './accounts.ts';
import type { Capabilities } from './context.ts';
import type { LoginChangeInput } from './forms.ts';
import {
	accountExists,
	runStatements,
	type OperationResult,
	type StatementResult
} from './operations.ts';

export async function changeLogin(
	dbi: DatabaseInterface,
	server: PrivServer,
	caps: Pick<Capabilities, 'isCreateUser' | 'isGrantUser'>,
	input: LoginChangeInput
): Promise<OperationResult> {
	if (!caps.isCreateUser || !caps.isGrantUser) {
		return {
			ok: false,
			error: 'You do not have the privileges to administrate the users!',
			results: []
		};
	}
	const { from, to, mode } = input;
	if (from.user === to.user && from.host === to.host) {
		return {
			ok: false,
			error:
				"Username and hostname didn't change. If you only want to change the password, 'Change password' tab should be used.",
			results: []
		};
	}
	if (await accountExists(dbi, to)) {
		return { ok: false, error: `The user '${to.user}'@'${to.host}' already exists!`, results: [] };
	}
	const details = await readAccount(dbi, server, from);
	if (!details.properties.exists && details.grantsError) {
		return { ok: false, error: 'No user found.', results: [] };
	}
	const creds = await readAccountCredentials(dbi, server, from);
	let plan;
	try {
		plan = planChangeLogin(server, from, to, mode, {
			grants: details.grants,
			plugin: creds.plugin,
			passwordHash: creds.hash,
			ssl: details.properties.ssl,
			limits: details.properties.limits,
			locked: details.properties.locked,
			passwordExpired: details.properties.passwordExpired
		});
	} catch (e) {
		return { ok: false, error: (e as Error).message, results: [] };
	}
	const copied = await runStatements(dbi, plan.copy, true);
	const results: StatementResult[] = [...copied];
	if (copied.some((r) => !r.ok)) {
		return { ok: false, error: copied.find((r) => !r.ok)?.error, results };
	}
	results.push(...(await runStatements(dbi, plan.cleanup)));
	return { ok: results.every((r) => r.ok), results };
}
