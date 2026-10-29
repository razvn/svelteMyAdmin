import { N_ } from '#lib/i18n/index.ts';
/**
 * Parsing and validation of the privilege forms (zod). The form field names follow phpMyAdmin's
 * (`pred_username`, `pred_hostname`, `pma_pw`, `max_questions`, `ssl_type`, ...); privileges are posted as a
 * repeated `priv` field holding the SQL keyword.
 */
import { z } from 'zod';
import {
	isCopyMode,
	isValidPluginName,
	type CopyMode,
	type Account,
	type DatabaseGrantChoice,
	type ResourceLimits,
	type SslRequirement
} from '#lib/sql/privileges/index.ts';
import type { GlobalUpdateInput, NewAccountInput } from './operations.ts';

export type Parsed<T> =
	| { ok: true; value: T }
	| { ok: false; error: string; errorParams?: Record<string, string | number> };

const text = (fd: FormData, name: string): string => {
	const v = fd.get(name);
	return typeof v === 'string' ? v : '';
};
const flag = (fd: FormData, name: string): boolean => {
	const v = fd.get(name);
	return typeof v === 'string' && v !== '' && v !== '0' && v !== 'false';
};

const limitSchema = z.coerce.number().int().min(0).max(4_294_967_295).catch(0);

/** `max_questions` ... fields (resource limits, 0 = unlimited). */
export function parseLimits(fd: FormData): ResourceLimits {
	return {
		maxQuestions: limitSchema.parse(text(fd, 'max_questions') || 0),
		maxConnections: limitSchema.parse(text(fd, 'max_connections') || 0),
		maxUpdates: limitSchema.parse(text(fd, 'max_updates') || 0),
		maxUserConnections: limitSchema.parse(text(fd, 'max_user_connections') || 0)
	};
}

const sslSchema = z.enum(['NONE', 'ANY', 'X509', 'SPECIFIED']).catch('NONE');

/** `ssl_type`, `ssl_cipher`, `x509_issuer`, `x509_subject`. */
export function parseSsl(fd: FormData): SslRequirement {
	const type = sslSchema.parse(text(fd, 'ssl_type') || 'NONE');
	if (type !== 'SPECIFIED') return { type };
	return {
		type,
		cipher: text(fd, 'ssl_cipher').trim(),
		issuer: text(fd, 'x509_issuer').trim(),
		subject: text(fd, 'x509_subject').trim()
	};
}

/** The repeated `priv` fields. */
export const parsePrivileges = (fd: FormData): string[] =>
	fd
		.getAll('priv')
		.filter((v): v is string => typeof v === 'string')
		.map((v) => v.trim())
		.filter((v) => v !== '');

export interface NewAccountContext {
	lengths: { user: number; host: number };
	/** Host part of USER(), for the "This host" option. */
	thisHost: string;
	plugins: readonly string[];
}

const predUser = z.enum(['any', 'userdefined']).catch('userdefined');
const predHost = z.enum(['any', 'localhost', 'thishost', 'hosttable', 'userdefined']).catch('any');
const predPassword = z.enum(['none', 'userdefined']).catch('userdefined');

/** Reads the password fields shared by Add user and Change password. */
export function parsePasswordFields(fd: FormData, mode: 'none' | 'userdefined'): Parsed<string> {
	if (mode === 'none') return { ok: true, value: '' };
	const pw = text(fd, 'pma_pw');
	const pw2 = text(fd, 'pma_pw2');
	if (pw.length === 0 || pw2.length === 0) return { ok: false, error: N_('The password is empty!') };
	if (pw !== pw2) return { ok: false, error: N_("The passwords aren't the same!") };
	if (pw.length > 256) return { ok: false, error: N_('Password is too long!') };
	return { ok: true, value: pw };
}

/** Add user account form -> {@link NewAccountInput}. */
export function parseNewAccountForm(fd: FormData, ctx: NewAccountContext): Parsed<NewAccountInput> {
	const user = predUser.parse(text(fd, 'pred_username')) === 'any' ? '' : text(fd, 'username');
	if (user === '' && predUser.parse(text(fd, 'pred_username')) !== 'any') {
		return { ok: false, error: N_('The user name is empty!') };
	}
	if (user.length > ctx.lengths.user) {
		return {
			ok: false,
			error: N_('The user name is too long (maximum {max} characters).'),
			errorParams: { max: ctx.lengths.user }
		};
	}
	if (user.includes('\0')) return { ok: false, error: N_('Invalid user name.') };

	let host: string;
	switch (predHost.parse(text(fd, 'pred_hostname'))) {
		case 'any':
			host = '%';
			break;
		case 'localhost':
			host = 'localhost';
			break;
		case 'hosttable':
			host = '';
			break;
		case 'thishost':
			host = ctx.thisHost;
			break;
		default:
			host = text(fd, 'hostname').trim();
			if (host === '') return { ok: false, error: N_('The host name is empty!') };
	}
	if (host.length > ctx.lengths.host || host.includes('\0')) {
		return { ok: false, error: N_('Invalid host name.') };
	}

	const pw = parsePasswordFields(fd, predPassword.parse(text(fd, 'pred_password')));
	if (!pw.ok) return pw;

	const plugin = text(fd, 'authentication_plugin');
	if (plugin !== '' && (!isValidPluginName(plugin) || !ctx.plugins.includes(plugin))) {
		return { ok: false, error: N_('Unknown authentication plugin.') };
	}

	const databases: DatabaseGrantChoice = {
		createSameName: flag(fd, 'createdb-1') && user !== '',
		wildcard: flag(fd, 'createdb-2') && user !== '',
		database: flag(fd, 'createdb-3') ? text(fd, 'dbname') || undefined : undefined
	};
	return {
		ok: true,
		value: {
			account: { user, host },
			plugin: plugin || undefined,
			password: pw.value,
			privileges: parsePrivileges(fd),
			grantOption: flag(fd, 'grant_option'),
			ssl: parseSsl(fd),
			limits: parseLimits(fd),
			databases
		}
	};
}

/** Edit privileges (Global tab) form. */
export function parseGlobalForm(fd: FormData, account: Account): GlobalUpdateInput {
	return {
		account,
		privileges: parsePrivileges(fd),
		grantOption: flag(fd, 'grant_option'),
		ssl: parseSsl(fd),
		limits: parseLimits(fd)
	};
}

/** `selected_usr` checkbox value for an account (reversible, no control characters). */
export const encodeAccount = (a: Account): string =>
	`${encodeURIComponent(a.user)}|${encodeURIComponent(a.host)}`;

export function decodeAccount(value: string): Account | null {
	const parts = value.split('|');
	if (parts.length !== 2) return null;
	try {
		return { user: decodeURIComponent(parts[0]), host: decodeURIComponent(parts[1]) };
	} catch {
		return null;
	}
}

/** The checked `selected_usr` rows, decoded and de-duplicated. */
export function parseSelectedAccounts(fd: FormData): Account[] {
	const seen = new Set<string>();
	const out: Account[] = [];
	for (const v of fd.getAll('selected_usr')) {
		if (typeof v !== 'string') continue;
		const a = decodeAccount(v);
		if (!a) continue;
		const k = encodeAccount(a);
		if (seen.has(k)) continue;
		seen.add(k);
		out.push(a);
	}
	return out;
}

export interface LoginChangeInput {
	from: Account;
	to: Account;
	mode: CopyMode;
}

/**
 * Change login information form: `username` / `hostname` (empty = keep the current one) and the
 * phpMyAdmin `mode` radio (4 keep the old account, 1/2/3 delete it).
 */
export function parseLoginForm(
	fd: FormData,
	from: Account,
	lengths: { user: number; host: number }
): Parsed<LoginChangeInput> {
	const user = text(fd, 'username') === '' ? from.user : text(fd, 'username');
	const host = text(fd, 'hostname').trim() === '' ? from.host : text(fd, 'hostname').trim();
	if (user.length > lengths.user)
		return {
			ok: false,
			error: N_('The user name is too long (maximum {max} characters).'),
			errorParams: { max: lengths.user }
		};
	if (host.length > lengths.host) return { ok: false, error: N_('Invalid host name.') };
	if (user.includes('\0') || host.includes('\0')) return { ok: false, error: N_('Invalid name.') };
	const mode = Number(text(fd, 'mode') || 4);
	if (!isCopyMode(mode)) return { ok: false, error: N_('Invalid mode.') };
	return { ok: true, value: { from, to: { user, host }, mode } };
}

/** `?username=&hostname=` of the edit page. */
export const accountQuerySchema = z.object({
	username: z.string().max(512),
	hostname: z.string().max(512)
});
