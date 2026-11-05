/**
 * `statement` events: every write statement (the ones change tracking records) run on the
 * per-request connection, succeeded or failed. Reads are not logged: the app runs its own on the
 * same connection. Independent of change tracking; the two layers compose in either order.
 */
import type { Connection } from 'mysql2/promise';
import { inlineValues, intercept, statementOf } from '#lib/server/db/intercept.ts';
import { isWriteStatement, parseUse, stripLeadingComments } from '#lib/tracking/analyse.ts';
import type { StatementOutcome } from './events.ts';
import type { RequestAudit } from './index.ts';

/** Account, privilege, routine and server administration: outside change tracking, central to an audit. */
const ADMIN = new RegExp(
	'^(?:' +
		[
			String.raw`(?:CREATE|ALTER|DROP|RENAME)\s+(?:USER|ROLE)\b`,
			String.raw`(?:GRANT|REVOKE|CALL|KILL|FLUSH|RESET)\b`,
			String.raw`SET\s+(?:PASSWORD|DEFAULT\s+ROLE|ROLE|GLOBAL|PERSIST(?:_ONLY)?|@@(?:GLOBAL|PERSIST))\b`,
			String.raw`(?:CREATE|ALTER|DROP)\s+(?:OR\s+REPLACE\s+)?(?:DEFINER\s*=\s*\S+\s+)?(?:PROCEDURE|FUNCTION|EVENT|TRIGGER)\b`,
			String.raw`LOAD\s+(?:DATA|XML)\b`,
			String.raw`(?:INSTALL|UNINSTALL)\s+(?:PLUGIN|SONAME|COMPONENT)\b`,
			String.raw`(?:START|STOP|CHANGE)\s+(?:SLAVE|REPLICA|MASTER|REPLICATION)\b`,
			String.raw`PURGE\s+(?:BINARY|MASTER)\b`
		].join('|') +
		')',
	'i'
);

/** Statements that end up in the audit log: change tracking's writes plus administration. */
export const isAuditedStatement = (sql: string): boolean =>
	isWriteStatement(sql) || ADMIN.test(stripLeadingComments(sql));

const QUOTED = String.raw`(?:'(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.|"")*")`;
const SECRETS = [
	// IDENTIFIED [WITH plugin] BY 'pw' | BY PASSWORD 'hash' | WITH plugin AS 'hash' | VIA plugin USING 'hash'
	// (the plugin name may itself be quoted)
	new RegExp(
		String.raw`(\bIDENTIFIED\b(?:[^'"]|${QUOTED})*?\b(?:BY(?:\s+PASSWORD)?|AS|USING)\s*)${QUOTED}`,
		'gi'
	),
	// PASSWORD('pw') (MariaDB), REPLACE 'current' (MySQL ALTER USER)
	new RegExp(String.raw`(\bPASSWORD\s*\(\s*)${QUOTED}(?=\s*\))`, 'gi'),
	new RegExp(String.raw`(\bREPLACE\s+)${QUOTED}`, 'gi'),
	// SET PASSWORD [FOR user] = 'pw'
	new RegExp(String.raw`(\bSET\s+PASSWORD\b[^=]*=\s*)${QUOTED}`, 'gi')
];

/** Mask password literals and hashes: a password must never reach the log. */
export function redactSecrets(sql: string): string {
	return SECRETS.reduce((s, re) => s.replace(re, "$1'***'"), sql);
}

function affectedRows(result: unknown): number | undefined {
	const header = Array.isArray(result) ? result[0] : undefined;
	const n = (header as { affectedRows?: unknown } | undefined)?.affectedRows;
	return typeof n === 'number' ? n : undefined;
}

function errorCode(e: unknown): string {
	const err = (e ?? {}) as { code?: unknown; errno?: unknown };
	if (typeof err.code === 'string') return err.code;
	if (typeof err.errno === 'number') return String(err.errno);
	return 'UNKNOWN';
}

/** Wrap `conn` (in place). Returns the undo. */
export function installAudit(
	conn: Connection,
	audit: RequestAudit,
	options: { includeValues: boolean }
): () => void {
	let currentDb: string | null = null;
	return intercept(conn, async (next, args) => {
		const statement = statementOf(args);
		if (!statement) return next(...args);
		const use = parseUse(statement.sql);
		if (use) {
			const result = await next(...args);
			currentDb = use;
			return result;
		}
		if (!isAuditedStatement(statement.sql)) return next(...args);

		const sql = redactSecrets(
			options.includeValues ? inlineValues(conn, statement) : statement.sql
		);
		const log = (outcome: StatementOutcome) =>
			audit.write({ event: 'statement', db: currentDb, sql, ...outcome });
		let result: unknown;
		try {
			result = await next(...args);
		} catch (e) {
			log({ ok: false, errorCode: errorCode(e) });
			throw e;
		}
		const rows = affectedRows(result);
		log(rows === undefined ? { ok: true } : { ok: true, affectedRows: rows });
		return result;
	});
}
