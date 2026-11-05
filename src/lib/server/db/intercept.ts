/**
 * Layered wrappers around `query`/`execute` of a connection (change tracking, audit log). Each layer
 * calls the next one, so a user statement passes every layer once whatever the install order. A
 * layer's own queries go through `bareConnection`, which no layer sees.
 */
import type { Connection } from 'mysql2/promise';

export type QueryFn = (...args: unknown[]) => Promise<unknown>;

/** SQL text and separately passed values of a `query()`/`execute()` call. */
export interface Statement {
	sql: string;
	values: unknown[] | undefined;
}

export function statementOf(args: unknown[]): Statement | null {
	const [first, second] = args;
	if (typeof first === 'string') {
		return { sql: first, values: Array.isArray(second) ? second : undefined };
	}
	if (first && typeof first === 'object' && typeof (first as { sql?: unknown }).sql === 'string') {
		const o = first as { sql: string; values?: unknown };
		const values = o.values ?? second;
		return { sql: o.sql, values: Array.isArray(values) ? values : undefined };
	}
	return null;
}

/** The statement with its values inlined (`conn.format`), as MySQL runs it. */
export function inlineValues(conn: Connection, { sql, values }: Statement): string {
	if (values === undefined) return sql;
	try {
		return (conn as unknown as { format(s: string, v: unknown): string }).format(sql, values);
	} catch {
		return sql;
	}
}

const bares = new WeakMap<Connection, Connection>();

/** `conn` with the driver's own `query`/`execute`, bypassing every installed layer. */
export function bareConnection(conn: Connection): Connection {
	let bare = bares.get(conn);
	if (bare) return bare;
	const own = (m: 'query' | 'execute') =>
		typeof conn[m] === 'function' ? (conn[m] as QueryFn).bind(conn) : conn[m];
	const originals = { query: own('query'), execute: own('execute') };
	bare = new Proxy(conn, {
		get(target, prop) {
			if (prop === 'query' || prop === 'execute') return originals[prop];
			const v = Reflect.get(target, prop, target);
			return typeof v === 'function' ? v.bind(target) : v;
		}
	});
	bares.set(conn, bare);
	return bare;
}

/**
 * Install one layer on `conn.query` and `conn.execute` (in place). `around` receives the next layer
 * and the call arguments. Returns the undo; undo layers in the reverse order of installation.
 */
export function intercept(
	conn: Connection,
	around: (next: QueryFn, args: unknown[]) => Promise<unknown>
): () => void {
	bareConnection(conn);
	const restore: (() => void)[] = [];
	const target = conn as unknown as Record<string, unknown>;
	for (const method of ['query', 'execute'] as const) {
		const previous = Object.getOwnPropertyDescriptor(conn, method);
		const next = (conn[method] as QueryFn).bind(conn);
		restore.push(() => {
			if (previous) Object.defineProperty(conn, method, previous);
			else delete target[method];
		});
		target[method] = (...args: unknown[]) => around(next, args);
	}
	return () => {
		for (const r of restore) r();
	};
}
