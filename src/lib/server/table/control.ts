import type { Connection } from 'mysql2/promise';
import { createConnection } from '#lib/server/db/connection.ts';

/**
 * Run `fn` on the configuration storage connection: the control user when configured, else the
 * user's own connection. Returns undefined when the storage is unreachable (callers fall back).
 */
export async function withControl<T>(
	locals: App.Locals,
	fn: (conn: Connection) => Promise<T>
): Promise<T | undefined> {
	const server = locals.server;
	let own: Connection | undefined;
	try {
		let conn: Connection;
		if (server.controluser) {
			own = await createConnection(
				{
					...server,
					host: server.controlhost || server.host,
					port: server.controlport || server.port
				},
				server.controluser,
				server.controlpass
			);
			conn = own;
		} else {
			conn = await locals.db;
		}
		return await fn(conn);
	} catch {
		return undefined;
	} finally {
		await own?.end().catch(() => {});
	}
}
