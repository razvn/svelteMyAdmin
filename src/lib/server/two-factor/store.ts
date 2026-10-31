/**
 * Load/save the `2fa` entry in `pma__userconfig` (TwoFactor::readConfig / save). Unlike the preference
 * loader this does not swallow errors: when the storage is configured but unreachable the caller must
 * not treat the user as "has no second factor".
 */
import type { Connection } from 'mysql2/promise';
import type { ServerConfig } from '#lib/server/config/schema.ts';
import { storageRepos } from '#lib/server/storage/index.ts';
import type { UserConfigRepo } from '#lib/server/storage/types.ts';
import type { PrefData } from '#lib/preferences/logic.ts';
import { readTwoFactorConfig, withTwoFactorConfig, type TwoFactorConfig } from './config.ts';

/** The connection of the user's own session; closed afterwards when `closeOwn`. */
export interface OwnConnection {
	get: () => Promise<Connection>;
	closeOwn?: boolean;
}

const NO_SUCH_TABLE = new Set(['ER_NO_SUCH_TABLE', 'ER_BAD_DB_ERROR', 'ER_DBACCESS_DENIED_ERROR']);

/**
 * Run `fn` on the configuration storage. Resolves null when the userconfig feature is not configured or
 * its table does not exist; rejects on any other failure.
 */
export async function withStorage<T>(
	server: ServerConfig,
	own: OwnConnection,
	fn: (repo: UserConfigRepo) => Promise<T>
): Promise<T | null> {
	let ownConn: Promise<Connection> | undefined;
	const repo = storageRepos(server, () => (ownConn ??= own.get())).userConfig;
	if (!repo) return null;
	try {
		return await fn(repo);
	} catch (e) {
		const code = (e as { code?: string }).code;
		if (code && NO_SUCH_TABLE.has(code)) return null;
		throw e;
	} finally {
		if (own.closeOwn) await (await ownConn?.catch(() => undefined))?.end().catch(() => {});
	}
}

export interface LoadedTwoFactor {
	config: TwoFactorConfig;
	prefs: PrefData;
}

/** null = the storage is not available (2FA cannot be configured, nor required). */
export function loadTwoFactor(
	server: ServerConfig,
	own: OwnConnection,
	user: string
): Promise<LoadedTwoFactor | null> {
	return withStorage(server, own, async (repo) => {
		const row = await repo.load(user);
		const prefs = row?.data ?? {};
		return { config: readTwoFactorConfig(prefs), prefs };
	});
}

/** Write the `2fa` entry, keeping every other preference. */
export function saveTwoFactor(
	server: ServerConfig,
	own: OwnConnection,
	user: string,
	config: TwoFactorConfig
): Promise<boolean | null> {
	return withStorage(server, own, async (repo) => {
		const row = await repo.load(user);
		await repo.save(user, withTwoFactorConfig(row?.data ?? {}, config));
		return true;
	});
}
