/**
 * Load/save the `2fa` entry in `pma__userconfig` (TwoFactor::readConfig / save). Unlike the preference
 * loader this does not swallow errors: when the storage is configured but unreachable the caller must
 * not treat the user as "has no second factor".
 */
import type { Connection } from 'mysql2/promise';
import type { ServerConfig } from '#lib/server/config/schema.ts';
import { createConnection } from '#lib/server/db/connection.ts';
import { loadUserConfig, saveUserConfig, userConfigTable } from '#lib/server/pmadb/userconfig.ts';
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
	fn: (conn: Connection, table: string) => Promise<T>
): Promise<T | null> {
	const table = userConfigTable(server);
	if (!table) return null;
	let control: Connection | undefined;
	let ownConn: Connection | undefined;
	try {
		let conn: Connection;
		if (server.controluser) {
			control = await createConnection(
				{
					...server,
					host: server.controlhost || server.host,
					port: server.controlport || server.port
				},
				server.controluser,
				server.controlpass
			);
			conn = control;
		} else {
			ownConn = await own.get();
			conn = ownConn;
		}
		return await fn(conn, table);
	} catch (e) {
		const code = (e as { code?: string }).code;
		if (code && NO_SUCH_TABLE.has(code)) return null;
		throw e;
	} finally {
		await control?.end().catch(() => {});
		if (own.closeOwn) await ownConn?.end().catch(() => {});
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
	return withStorage(server, own, async (conn, table) => {
		const row = await loadUserConfig(conn, table, user);
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
	return withStorage(server, own, async (conn, table) => {
		const row = await loadUserConfig(conn, table, user);
		await saveUserConfig(conn, table, user, withTwoFactorConfig(row?.data ?? {}, config));
		return true;
	});
}
