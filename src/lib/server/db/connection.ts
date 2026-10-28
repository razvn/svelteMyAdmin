import { readFileSync } from 'node:fs';
import {
	createConnection as mysqlCreateConnection,
	type Connection,
	type ConnectionOptions
} from 'mysql2/promise';
import type { ServerConfig } from '../config/schema';

export type { Connection };

export interface ConnectOptions {
	/** Allow several statements in one query() call (off by default; use the SQL splitter instead). */
	multipleStatements?: boolean;
	/** Connection collation applied with `SET collation_connection` after connecting. */
	collation?: string;
	/** Extra mysql2 options (override everything else). */
	extra?: Partial<ConnectionOptions>;
}

export type ConnectionServer = Pick<
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
>;

/**
 * Build mysql2 options from a phpMyAdmin-style server definition.
 *
 * - dates/times stay strings (`dateStrings`) so no timezone conversion happens;
 * - BIGINT/DECIMAL come back as strings (`supportBigNumbers` + `bigNumberStrings`);
 * - JSON columns stay raw text (`jsonStrings`);
 * - no custom `typeCast`: mysql2 already returns binary-charset columns
 *   (BLOB, BINARY, GEOMETRY, ...) as Buffer and text columns as strings.
 */
export function buildConnectionOptions(
	server: ConnectionServer,
	user: string,
	password: string,
	options: ConnectOptions = {}
): ConnectionOptions {
	const opts: ConnectionOptions = {
		user,
		password,
		multipleStatements: options.multipleStatements ?? false,
		dateStrings: true,
		supportBigNumbers: true,
		bigNumberStrings: true,
		jsonStrings: true,
		charset: 'utf8mb4'
	};
	if (server.socket) {
		opts.socketPath = server.socket;
	} else {
		opts.host = server.host || 'localhost';
		if (server.port) opts.port = server.port;
	}
	if (server.compress) opts.compress = true;
	if (server.ssl) {
		opts.ssl = {
			rejectUnauthorized: server.ssl_verify,
			...(server.ssl_ca ? { ca: readFileSync(server.ssl_ca) } : {}),
			...(server.ssl_cert ? { cert: readFileSync(server.ssl_cert) } : {}),
			...(server.ssl_key ? { key: readFileSync(server.ssl_key) } : {}),
			...(server.ssl_ciphers ? { ciphers: server.ssl_ciphers } : {})
		};
	}
	return { ...opts, ...options.extra };
}

const COLLATION_NAME = /^[A-Za-z0-9_]{1,64}$/;

export const isValidCollationName = (name: string): boolean => COLLATION_NAME.test(name);

/**
 * `SET collation_connection` (phpMyAdmin: "Server connection collation"). Unknown collations
 * (other server flavour) are ignored. Returns whether it was applied.
 */
export async function applyConnectionCollation(
	conn: Pick<Connection, 'query'>,
	collation: string | undefined
): Promise<boolean> {
	if (!collation || !isValidCollationName(collation)) return false;
	try {
		await conn.query('SET collation_connection = ?', [collation]);
		return true;
	} catch {
		return false;
	}
}

/** Open a single connection. The caller is responsible for calling `end()`. */
export async function createConnection(
	server: ConnectionServer,
	user: string,
	password: string,
	options?: ConnectOptions
): Promise<Connection> {
	const conn = await mysqlCreateConnection(buildConnectionOptions(server, user, password, options));
	await applyConnectionCollation(conn, options?.collation);
	return conn;
}
