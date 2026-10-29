import { N_ } from '#lib/i18n/index.ts';
/** Authentication plugins offered when creating an account or changing a password. */
import type { PrivServer } from './types.ts';

export interface AuthPluginDef {
	name: string;
	label: string;
	engine?: 'mysql' | 'mariadb';
	/** First version (inclusive) that ships the plugin. */
	since?: number;
	/** Authenticates without a password (OS user, ...): never combined with BY / USING. */
	passwordless?: boolean;
	/** Needs an SSL connection or RSA key exchange for the first login (sha256 family). */
	needsSecureChannel?: boolean;
}

export const AUTH_PLUGINS: readonly AuthPluginDef[] = [
	{
		name: 'caching_sha2_password',
		label: N_('Caching sha2 authentication'),
		engine: 'mysql',
		since: 80000
	},
	{ name: 'mysql_native_password', label: N_('Native MySQL authentication') },
	{
		name: 'sha256_password',
		label: N_('SHA256 password authentication'),
		engine: 'mysql',
		since: 50606,
		needsSecureChannel: true
	},
	{
		name: 'ed25519',
		label: N_('Ed25519 Password Authentication'),
		engine: 'mariadb',
		since: 100102
	},
	{
		name: 'unix_socket',
		label: N_('Unix Socket Authentication'),
		engine: 'mariadb',
		passwordless: true
	},
	{ name: 'auth_socket', label: N_('Unix Socket Authentication'), engine: 'mysql', passwordless: true }
];

export const NATIVE_PLUGIN = 'mysql_native_password';

/** Listed by the server but not usable to identify an account. */
const HIDDEN_PLUGINS = new Set(['mysql_old_password', 'mysql_clear_password']);

export function findAuthPlugin(name: string): AuthPluginDef | undefined {
	return AUTH_PLUGINS.find((p) => p.name === name);
}

/** Plugin whose name is safe to put into a statement unquoted (identifier characters only). */
export const isValidPluginName = (name: string): boolean => /^[A-Za-z0-9_]{1,64}$/.test(name);

/**
 * Plugins that can be offered on this server. With `active` (the AUTHENTICATION plugins reported by
 * `information_schema.PLUGINS` with status ACTIVE) only installed plugins are returned, and active plugins that
 * are not in the catalogue are appended with their own name as label.
 */
export function authPluginsFor(
	server: PrivServer,
	active?: readonly { name: string; description?: string }[]
): { name: string; label: string; passwordless: boolean }[] {
	const known = AUTH_PLUGINS.filter((p) => {
		if (p.engine === 'mariadb' && !server.isMariaDB) return false;
		if (p.engine === 'mysql' && server.isMariaDB) return false;
		return p.since === undefined || server.version >= p.since;
	});
	if (!active) {
		// Without a plugin list: the ones that need no installation.
		return known
			.filter((p) => !p.passwordless && p.name !== 'ed25519')
			.map((p) => ({ name: p.name, label: p.label, passwordless: false }));
	}
	const names = new Set(active.map((a) => a.name));
	const out = known
		.filter((p) => names.has(p.name))
		.map((p) => ({ name: p.name, label: p.label, passwordless: p.passwordless === true }));
	for (const a of active) {
		if (!isValidPluginName(a.name) || HIDDEN_PLUGINS.has(a.name)) continue;
		if (out.some((o) => o.name === a.name)) continue;
		out.push({ name: a.name, label: a.description || a.name, passwordless: false });
	}
	return out;
}

/** The plugin new accounts get when none is chosen. */
export function defaultAuthPlugin(server: PrivServer): string {
	if (server.isMariaDB) return NATIVE_PLUGIN;
	return server.version >= 80000 ? 'caching_sha2_password' : NATIVE_PLUGIN;
}
