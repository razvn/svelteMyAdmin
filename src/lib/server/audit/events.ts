/**
 * Audit log events: one JSON object per line answering "who did what, when, from where, on which
 * server". See docs/AUDIT.md.
 */
import type { RuleFailure } from '#lib/server/auth/errors.ts';

/** Who acted, filled in by the request's audit (`locals.audit`). */
export interface Actor {
	/** Verified person (`session.storageUser`: SSO identity for signon, else the MySQL user); null when unauthenticated. */
	identity: string | null;
	/** MySQL account used (the shared one for signon); null when none was accepted. */
	mysqlUser: string | null;
	/** Signon only: e-mail forwarded by the SSO proxy. */
	email?: string;
	/** Server label (`verbose`, else host[:port]). */
	server: string;
	/** Stable server name: the 1-based position in `Servers`, or `k8s:<namespace>/<service>` when discovered. */
	serverId: string;
	clientIp: string | null;
}

export type DeniedReason =
	/** AllowDeny / AllowRoot / AllowNoPassword. */
	| RuleFailure
	/** Signon: identity header sent by a peer outside `trustedProxies`. */
	| 'untrusted-proxy'
	/** Signon: identity header from a trusted proxy with an unusable value. */
	| 'invalid-identity'
	/** Signon: `Signon.authorize` (Kubernetes RBAC) refused the person on this server. */
	| 'not-authorized'
	/** Signon: `Signon.authorize` could not be checked (API server unreachable, error answer). */
	| 'authorization-error'
	/** MySQL refused the user name / password (cookie or http login). */
	| 'access-denied'
	/** The login could not reach MySQL, or failed for another server-side reason. */
	| 'login-failed'
	/** The login form was invalid (unknown server, empty user, oversized password, bad host). */
	| 'invalid-login';

export type ExportAuditScope = 'server' | 'db' | 'table' | 'rows';

export type StatementOutcome =
	{ ok: true; affectedRows?: number } | { ok: false; errorCode: string };

export type AuditBody =
	| { event: 'session' }
	| ({ event: 'statement'; db: string | null; sql: string } & StatementOutcome)
	| {
			event: 'export';
			scope: ExportAuditScope;
			format: string;
			db?: string;
			/** Server scope: the exported databases. */
			databases?: string[];
			tables?: string[];
			/** Exports of a query's result. */
			sql?: string;
	  }
	| { event: 'logout' }
	/** `claimedUser`: the user name presented but not verified (the event's `identity` is null). */
	| { event: 'denied'; reason: DeniedReason; claimedUser?: string };

export type AuditEvent = { ts: string } & Actor & AuditBody;

const MAX_CLAIMED_USER = 256;

/** One JSON Lines record (no trailing newline). SQL longer than `maxSqlLength` is cut and flagged. */
export function formatLine(e: AuditEvent, maxSqlLength: number): string {
	const { ts, event, identity, mysqlUser, email, server, serverId, clientIp, ...rest } = e;
	const body: Record<string, unknown> = { ...rest };
	if (typeof body.sql === 'string' && body.sql.length > maxSqlLength) {
		body.sql = body.sql.slice(0, maxSqlLength);
		body.truncated = true;
	}
	if (typeof body.claimedUser === 'string') {
		body.claimedUser = body.claimedUser.slice(0, MAX_CLAIMED_USER);
	}
	return JSON.stringify({
		ts,
		event,
		identity,
		mysqlUser,
		...(email ? { email } : {}),
		server,
		serverId,
		clientIp,
		...body
	});
}
