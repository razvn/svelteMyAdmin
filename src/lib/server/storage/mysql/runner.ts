/**
 * How the MySQL repositories reach the pmadb: a runner executes a function on a storage connection
 * (the control user's own connection when configured, else the user's connection) and releases it.
 */
import type { Connection } from 'mysql2/promise';
import type { ServerConfig } from '#lib/server/config/schema.ts';
import { createConnection } from '#lib/server/db/connection.ts';

export type Run = <T>(fn: (conn: Connection) => Promise<T>) => Promise<T>;

export type ControlServer = Pick<
	ServerConfig,
	| 'host'
	| 'port'
	| 'socket'
	| 'ssl'
	| 'ssl_ca'
	| 'ssl_cert'
	| 'ssl_key'
	| 'ssl_ciphers'
	| 'ssl_verify'
	| 'compress'
	| 'controlhost'
	| 'controlport'
	| 'controluser'
	| 'controlpass'
>;

/**
 * Runner on the control connection (opened and closed per call) or, without a control user, on the
 * connection returned by `own` (never closed here). Rejects when the connection or `fn` fails.
 */
export function controlRunner(server: ControlServer, own: () => Promise<Connection>): Run {
	return async (fn) => {
		if (!server.controluser) return fn(await own());
		const conn = await createConnection(
			{
				...server,
				host: server.controlhost || server.host,
				port: server.controlport || server.port
			},
			server.controluser,
			server.controlpass
		);
		try {
			return await fn(conn);
		} finally {
			await conn.end().catch(() => {});
		}
	};
}

/** Runner on one existing connection (tests, tracking hook). */
export const connectionRunner =
	(conn: Connection): Run =>
	(fn) =>
		fn(conn);

/** `ping()` of a MySQL repository: does `SELECT 1 FROM <table> LIMIT 1` work? */
export const pinger = (run: Run, qualified: string) => async (): Promise<boolean> => {
	try {
		await run((c) => c.query(`SELECT 1 FROM ${qualified} LIMIT 1`));
		return true;
	} catch {
		return false;
	}
};
