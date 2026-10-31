/**
 * Remembered browse preferences (sorting, rows per page, hidden columns).
 *
 * With the configuration storage (`pmadb` + `table_uiprefs`) they live in `pma__table_uiprefs`
 * (JSON `prefs` using phpMyAdmin's keys: `sorted_col`, `col_visib`; plus `max_rows`), so both
 * applications can share them. Without it (or when the storage is unreachable) a cookie is used.
 */
import { createHash } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import { withRepo } from '#lib/server/storage/index.ts';

export interface PrefsContext {
	locals: App.Locals;
	cookies: Cookies;
	db: string;
	table: string;
}

/** Stored preferences; unknown phpMyAdmin keys are preserved on write. */
export interface TablePrefs {
	sorted_col?: string;
	max_rows?: number | 'all';
	/** phpMyAdmin: one 0/1 per column, in table order. */
	col_visib?: number[];
	[key: string]: unknown;
}

const COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

const cookieName = (db: string, table: string) =>
	'sma_ui_' +
	createHash('sha1')
		.update(JSON.stringify([db, table]))
		.digest('hex')
		.slice(0, 16);

function parsePrefs(text: unknown): TablePrefs {
	if (typeof text !== 'string') return {};
	try {
		const v: unknown = JSON.parse(text);
		return v && typeof v === 'object' && !Array.isArray(v) ? (v as TablePrefs) : {};
	} catch {
		return {};
	}
}

/** Stored preferences: configuration storage when available, else the cookie. */
export async function loadPrefs(ctx: PrefsContext): Promise<TablePrefs> {
	const user = ctx.locals.session?.user ?? '';
	const stored = await withRepo(ctx.locals, 'tableUiPrefs', async (repo) => {
		const json = await repo.get(user, ctx.db, ctx.table);
		return json === null ? {} : parsePrefs(json);
	});
	if (stored) return stored;
	return parsePrefs(ctx.cookies.get(cookieName(ctx.db, ctx.table)));
}

/** Merge `patch` into the stored preferences; `undefined` values delete the key. */
export async function savePrefs(ctx: PrefsContext, patch: TablePrefs): Promise<void> {
	const current = await loadPrefs(ctx);
	const next: TablePrefs = { ...current };
	for (const [k, v] of Object.entries(patch)) {
		if (v === undefined) delete next[k];
		else next[k] = v;
	}
	const json = JSON.stringify(next);
	const user = ctx.locals.session?.user ?? '';
	const saved = await withRepo(ctx.locals, 'tableUiPrefs', async (repo) => {
		await repo.set(user, ctx.db, ctx.table, json);
		return true;
	});
	if (!saved) {
		ctx.cookies.set(cookieName(ctx.db, ctx.table), json, {
			path: '/',
			maxAge: COOKIE_MAX_AGE,
			httpOnly: true,
			sameSite: 'lax',
			secure: false
		});
	}
}

/** Hidden column names from `col_visib` (0 = hidden). */
export function hiddenFromPrefs(prefs: TablePrefs, columns: string[]): string[] {
	const v = prefs.col_visib;
	if (!Array.isArray(v)) return [];
	return columns.filter((_, i) => Number(v[i]) === 0);
}

export function visibilityFromHidden(hidden: string[], columns: string[]): number[] | undefined {
	const set = new Set(hidden);
	return set.size === 0 ? undefined : columns.map((c) => (set.has(c) ? 0 : 1));
}
