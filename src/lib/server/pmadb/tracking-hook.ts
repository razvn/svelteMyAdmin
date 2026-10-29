/**
 * The single choke point of change tracking: the per-request user connection is wrapped so every
 * successful write statement (SQL page, insert/edit, inline edit, structure/operations ALTERs,
 * import, ...) is analysed and appended to the active tracking version of the table it touches
 * (Tracker::handleQuery). Nothing is wrapped when the tracking storage is not configured.
 */
import type { Connection } from 'mysql2/promise';
import type { ServerConfig } from '#lib/server/config/schema.ts';
import { createConnection } from '#lib/server/db/connection.ts';
import { storageTable } from '#lib/server/pmadb/index.ts';
import { handleQuery, type TrackingCtx } from '#lib/server/pmadb/tracking.ts';
import { analyseStatement, parseUse } from '#lib/tracking/analyse.ts';

/** Quick pre-filter: only statements mentioning one of these keywords up front can be tracked. */
const CANDIDATE = /\b(?:create|alter|drop|rename|insert|replace|update|delete|truncate|use)\b/i;

function textOf(arg: unknown): string | null {
	if (typeof arg === 'string') return arg;
	if (arg && typeof arg === 'object' && typeof (arg as { sql?: unknown }).sql === 'string') {
		return (arg as { sql: string }).sql;
	}
	return null;
}

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
	const q = storageTable(server, 'tracking');
	if (!q) return null;

	let busy = false;
	let currentDb: string | null = null;
	let own: Connection | undefined;
	let broken = false;

	const ctx = async (): Promise<TrackingCtx | null> => {
		if (broken) return null;
		let c: Connection = conn;
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
			} catch {
				broken = true;
				return null;
			}
			c = own;
		}
		return { conn: c, q, user, server };
	};

	const record = async (sql: string | null) => {
		if (!sql || busy || !CANDIDATE.test(sql.slice(0, 300))) return;
		const use = parseUse(sql);
		if (use) {
			currentDb = use;
			return;
		}
		if (!analyseStatement(sql)) return;
		busy = true;
		try {
			const c = await ctx();
			if (c) await handleQuery(c, conn, currentDb, sql);
		} catch {
			// Tracking must never break the statement of the user.
		} finally {
			busy = false;
		}
	};

	const format = (sql: string, values: unknown): string => {
		if (values === undefined) return sql;
		try {
			return (conn as unknown as { format(s: string, v: unknown): string }).format(sql, values);
		} catch {
			return sql;
		}
	};

	const restore: (() => void)[] = [];
	for (const method of ['query', 'execute'] as const) {
		const previous = Object.getOwnPropertyDescriptor(conn, method);
		const original = conn[method].bind(conn) as (...a: unknown[]) => Promise<unknown>;
		restore.push(() => {
			if (previous) Object.defineProperty(conn, method, previous);
			else delete (conn as unknown as Record<string, unknown>)[method];
		});
		(conn as unknown as Record<string, unknown>)[method] = async (...args: unknown[]) => {
			const result = await original(...args);
			const sql = textOf(args[0]);
			if (sql !== null && !busy) {
				const values =
					args[0] && typeof args[0] === 'object'
						? (args[0] as { values?: unknown }).values
						: args[1];
				await record(format(sql, Array.isArray(values) ? values : undefined));
			}
			return result;
		};
	}

	return {
		async close() {
			for (const r of restore) r();
			const c = own;
			own = undefined;
			await c?.end().catch(() => {});
		}
	};
}
