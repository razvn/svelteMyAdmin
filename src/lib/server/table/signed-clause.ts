/**
 * Signed SQL fragments passed through URLs (phpMyAdmin's `where_clause` + `where_clause_sign`).
 *
 * Pages that link to a row (browse → edit/delete/copy) or to a filtered result set
 * (search → browse) put a SQL fragment in the URL. The server never trusts such a fragment
 * unless it carries a valid HMAC created by the server for the same database and table.
 *
 * URL contract (shared by browse, insert/edit and search):
 *   - a row:      `?where=<clause>&sig=<signature>`   (repeat both params for several rows, same order)
 *   - a filter:   `?filter=<clause>&fsig=<signature>` (applied as `WHERE <clause>` by browse)
 *
 * `secret` is `getSecret(locals.config.blowfish_secret)` from `#lib/server/auth/session.ts`.
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

const INFO = 'svelteMyAdmin signed clause v1';

const keys = new Map<string, Buffer>();

function keyFor(secret: string): Buffer {
	let key = keys.get(secret);
	if (!key) {
		key = Buffer.from(hkdfSync('sha256', secret, 'sma-clause', INFO, 32));
		keys.set(secret, key);
	}
	return key;
}

function mac(secret: string, db: string, table: string, clause: string): Buffer {
	return createHmac('sha256', keyFor(secret))
		.update(JSON.stringify([db, table, clause]))
		.digest();
}

/** Signature (base64url) binding `clause` to `db`.`table`. */
export function signClause(secret: string, db: string, table: string, clause: string): string {
	return mac(secret, db, table, clause).toString('base64url');
}

/** True when `sig` was produced by `signClause` for exactly this db, table and clause. */
export function verifyClause(
	secret: string,
	db: string,
	table: string,
	clause: string,
	sig: string | null | undefined
): boolean {
	if (!sig) return false;
	const given = Buffer.from(sig, 'base64url');
	const expected = mac(secret, db, table, clause);
	return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Read the signed clauses of `param`/`sigParam` from a URL. Returns null when any clause is
 * missing its signature or carries an invalid one (callers should answer 400).
 */
export function readSignedClauses(
	url: URL,
	secret: string,
	db: string,
	table: string,
	param = 'where',
	sigParam = 'sig'
): string[] | null {
	const clauses = url.searchParams.getAll(param);
	const sigs = url.searchParams.getAll(sigParam);
	if (clauses.length !== sigs.length) return null;
	for (let i = 0; i < clauses.length; i++) {
		if (!verifyClause(secret, db, table, clauses[i], sigs[i])) return null;
	}
	return clauses;
}
