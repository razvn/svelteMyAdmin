/**
 * Where a user's preferences live. With the `userconfig` table of the configuration storage they are
 * kept in `pma__userconfig` (type `db`, shared with phpMyAdmin); otherwise (or when the storage cannot be
 * read) in a cookie (type `session`, phpMyAdmin keeps them in `$_SESSION['userconfig']`).
 */
import type { Cookies } from '@sveltejs/kit';
import { parseConfigData, type PrefData } from '#lib/preferences/logic.ts';
import {
	loadUserConfig,
	saveUserConfig,
	userConfigTable,
	withUserConfig
} from '#lib/server/pmadb/userconfig.ts';

export type PrefsType = 'db' | 'session';

export interface LoadedPrefs {
	data: PrefData;
	type: PrefsType;
	/** Unix seconds of the last save (0 when unknown). */
	mtime: number;
	/** The storage is configured but could not be read. */
	unavailable: boolean;
}

export const PREFS_COOKIE = 'sma_userprefs';
/** Browsers cap a cookie at 4096 bytes including name and attributes. */
const MAX_COOKIE_VALUE = 3600;

const username = (locals: App.Locals) => locals.session?.user ?? '';

interface CookiePayload {
	u: string;
	s: number;
	t: number;
	d: PrefData;
}

function readCookie(locals: App.Locals, cookies: Cookies): { data: PrefData; mtime: number } {
	const raw = cookies.get(PREFS_COOKIE);
	if (!raw) return { data: {}, mtime: 0 };
	try {
		const p = JSON.parse(raw) as Partial<CookiePayload>;
		if (p.u !== username(locals) || p.s !== locals.serverIndex) return { data: {}, mtime: 0 };
		const data = parseConfigData(JSON.stringify(p.d ?? {}));
		return { data, mtime: typeof p.t === 'number' ? p.t : 0 };
	} catch {
		return { data: {}, mtime: 0 };
	}
}

export async function loadPrefs(locals: App.Locals, cookies: Cookies): Promise<LoadedPrefs> {
	const user = username(locals);
	if (user && userConfigTable(locals.server)) {
		const row = await withUserConfig(locals, (conn, table) => loadUserConfig(conn, table, user));
		if (row !== undefined) {
			return { data: row?.data ?? {}, type: 'db', mtime: row?.mtime ?? 0, unavailable: false };
		}
		return { ...readCookie(locals, cookies), type: 'session', unavailable: true };
	}
	return { ...readCookie(locals, cookies), type: 'session', unavailable: false };
}

/** Persist the full preference object. Returns an error message, or null on success. */
export async function savePrefs(
	locals: App.Locals,
	cookies: Cookies,
	data: PrefData,
	secure: boolean
): Promise<string | null> {
	const user = username(locals);
	if (!user) return locals.i18n.t('Could not save configuration');
	if (userConfigTable(locals.server)) {
		const ok = await withUserConfig(locals, async (conn, table) => {
			await saveUserConfig(conn, table, user, data);
			return true;
		});
		if (ok) {
			cookies.delete(PREFS_COOKIE, { path: '/' });
			return null;
		}
		return locals.i18n.t(
			'Could not save configuration: the phpMyAdmin configuration storage could not be reached.'
		);
	}
	if (Object.keys(data).length === 0) {
		cookies.delete(PREFS_COOKIE, { path: '/' });
		return null;
	}
	const payload: CookiePayload = {
		u: user,
		s: locals.serverIndex,
		t: Math.floor(Date.now() / 1000),
		d: data
	};
	const value = JSON.stringify(payload);
	if (encodeURIComponent(value).length > MAX_COOKIE_VALUE) {
		return locals.i18n.t(
			'The settings are too large to be kept without a configuration storage. Reset some of them or configure the userconfig table.'
		);
	}
	cookies.set(PREFS_COOKIE, value, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: 60 * 60 * 24 * 365
	});
	return null;
}
