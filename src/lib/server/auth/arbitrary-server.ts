import { N_ } from '#lib/i18n/translator.ts';
/** Convert a PHP-style regexp (`/^a.*$/i`) to a JS RegExp. Bare patterns are accepted too. */
export function parsePhpRegex(source: string): RegExp {
	const m = source.match(/^([/#~@%!|])(.*)\1([imsux]*)$/s);
	if (m) {
		const flags = [...new Set(m[3].replace(/[xu]/g, ''))].join('');
		return new RegExp(m[2], flags);
	}
	return new RegExp(source);
}

/** phpMyAdmin strips any `p:` (persistent connection) prefix from user supplied hosts. */
export function sanitizeHost(name: string): string {
	let host = name.trim();
	while (host.slice(0, 2).toLowerCase() === 'p:') host = host.slice(2);
	return host;
}

export type ArbitraryServerResult =
	{ ok: true; host: string; port: number | undefined } | { ok: false; error: string };

/**
 * Validate a user supplied host/port against `ArbitraryServerRegexp`
 * (see AuthenticationCookie::readCredentials).
 */
export function validateArbitraryServer(
	hostInput: string,
	portInput: string | number | undefined,
	regexp: string
): ArbitraryServerResult {
	const host = sanitizeHost(hostInput);
	// eslint-disable-next-line no-control-regex
	if (host === '' || /[\u0000-\u001f\s]/.test(host) || host.length > 255) {
		return { ok: false, error: N_('Invalid server name.') };
	}
	if (regexp) {
		let re: RegExp;
		try {
			re = parsePhpRegex(regexp);
		} catch {
			return { ok: false, error: N_('You are not allowed to log in to this MySQL server!') };
		}
		if (!re.test(host)) {
			return { ok: false, error: N_('You are not allowed to log in to this MySQL server!') };
		}
	}
	let port: number | undefined;
	if (portInput !== undefined && String(portInput).trim() !== '') {
		const n = Number(portInput);
		if (!Number.isInteger(n) || n < 1 || n > 65535) {
			return { ok: false, error: N_('Invalid port number.') };
		}
		port = n;
	}
	return { ok: true, host, port };
}
