/**
 * Map driver errors to phpMyAdmin-like login messages. Never includes stack traces,
 * credentials or driver internals.
 */
import { N_ } from '#lib/i18n/translator.ts';

export type RuleFailure = 'allow-denied' | 'root-denied' | 'empty-denied';

export const RULE_MESSAGES: Record<RuleFailure, string> = {
	'allow-denied': N_('Access denied!'),
	'root-denied': N_('Access denied!'),
	'empty-denied': N_('Login without a password is forbidden by configuration (see AllowNoPassword)')
};

export const GENERIC_LOGIN_ERROR = N_('Cannot log in to the MySQL server');

interface DriverError {
	code?: unknown;
	errno?: unknown;
	sqlMessage?: unknown;
	message?: unknown;
}

export function isAccessDenied(e: unknown): boolean {
	const err = e as DriverError | null;
	return !!err && (err.errno === 1045 || err.code === 'ER_ACCESS_DENIED_ERROR');
}

/** Message shown on the login form for a failed connection attempt. */
export function mapConnectError(e: unknown, hideConnectionErrors = false): string {
	if (hideConnectionErrors) return GENERIC_LOGIN_ERROR;
	const err = (e ?? {}) as DriverError;
	const code = typeof err.code === 'string' ? err.code : '';
	const errno = typeof err.errno === 'number' ? err.errno : undefined;

	if (isAccessDenied(e)) return GENERIC_LOGIN_ERROR;
	switch (code) {
		case 'ECONNREFUSED':
			return 'mysqli::real_connect(): (HY000/2002): Connection refused';
		case 'ENOTFOUND':
		case 'EAI_AGAIN':
			return 'mysqli::real_connect(): php_network_getaddresses: getaddrinfo failed: Name or service not known';
		case 'ETIMEDOUT':
		case 'EHOSTUNREACH':
		case 'ENETUNREACH':
			return 'mysqli::real_connect(): (HY000/2002): Connection timed out';
		case 'ENOENT':
			return 'mysqli::real_connect(): (HY000/2002): No such file or directory';
		case 'ECONNRESET':
		case 'PROTOCOL_CONNECTION_LOST':
			return 'mysqli::real_connect(): (HY000/2013): Lost connection to server';
	}
	if (errno === 1044 || code === 'ER_DBACCESS_DENIED_ERROR') return GENERIC_LOGIN_ERROR;
	if (errno === 1130 || code === 'ER_HOST_NOT_PRIVILEGED') {
		return 'mysqli::real_connect(): (HY000/1130): Host is not allowed to connect to this MySQL server';
	}
	if (errno !== undefined && errno >= 1000 && errno < 3000 && typeof err.sqlMessage === 'string') {
		// MySQL server error messages do not contain secrets.
		return `mysqli::real_connect(): (HY000/${errno}): ${err.sqlMessage}`;
	}
	return GENERIC_LOGIN_ERROR;
}
