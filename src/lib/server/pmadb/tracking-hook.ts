/**
 * The single choke point of change tracking: the per-request user connection is wrapped so every
 * successful write statement (SQL page, insert/edit, inline edit, structure/operations ALTERs,
 * import, ...) is analysed and appended to the active tracking version of the table it touches
 * (Tracker::handleQuery). Nothing is wrapped when the tracking storage is not configured.
 */
import type { Connection } from 'mysql2/promise';
import type { ServerConfig } from '#lib/server/config/schema.ts';
import { createConnection } from '#lib/server/db/connection.ts';
import { mysqlRepos, storageKind, storageRepos } from '#lib/server/storage/index.ts';
import type { Run } from '#lib/server/storage/mysql/runner.ts';
import type { TrackingRepo } from '#lib/server/storage/types.ts';
import { handleQuery, type TrackingCtx } from '#lib/server/pmadb/tracking.ts';
import { isWriteStatement, parseUse } from '#lib/tracking/analyse.ts';
import { bareConnection, inlineValues, intercept, statementOf } from '#lib/server/db/intercept.ts';

export interface TrackingHook {
	/** Release the lazily opened storage connection. */
	close(): Promise<void>;
}

/** Wrap `conn` (in place); returns null when tracking storage is not configured. */
export function installTracking(
	conn: Connection,
	server: ServerConfig,
	user: string
): TrackingHook | null {
	if (storageKind(server) === 'none') return null;

	// Appends run one after the other (a statement's record is awaited before its result is
	// returned, and close() waits for the tail), so no write is dropped or lost on close.
	let chain: Promise<void> = Promise.resolve();
	let currentDb: string | null = null;
	let own: Connection | undefined;
	let broken = false;
	// Tracking's own queries run on the bare connection: neither tracked again nor audited.
	const bare = bareConnection(conn);

	// MySQL: the storage connection is the control user's (opened once, lazily) or the bare user
	// connection; SQLite needs no connection.
	const run: Run = async (fn) => {
		let c: Connection = bare;
		if (server.controluser) {
			try {
				own ??= await createConnection(
					{
						...server,
						host: server.controlhost || server.host,
						port: server.controlport || server.port
					},
					server.controluser,
					server.controlpass
				);
			} catch (e) {
				console.error('[tracking] cannot open the control connection:', e);
				broken = true;
				throw e;
			}
			c = own;
		}
		return fn(c);
	};
	const repo: TrackingRepo | null =
		storageKind(server) === 'mysql'
			? mysqlRepos(server, run).tracking
			: storageRepos(server, async () => bare).tracking;
	if (!repo) return null;
	const ctx = (): TrackingCtx | null => (broken ? null : { repo, user, server });

	const record = (sql: string): Promise<void> => {
		const use = parseUse(sql);
		if (use) {
			currentDb = use;
			return Promise.resolve();
		}
		if (!isWriteStatement(sql)) return Promise.resolve();
		const db = currentDb;
		const run = chain.then(async () => {
			try {
				const c = ctx();
				if (c) await handleQuery(c, bare, db, sql);
			} catch (e) {
				// Tracking must never break the statement of the user.
				console.error('[tracking] failed to record statement:', e);
			}
		});
		chain = run;
		return run;
	};

	const restore = intercept(conn, async (next, args) => {
		const result = await next(...args);
		const statement = statementOf(args);
		if (statement) await record(inlineValues(conn, statement));
		return result;
	});

	return {
		async close() {
			await chain;
			restore();
			const c = own;
			own = undefined;
			await c?.end().catch(() => {});
		}
	};
}
