import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { availableCodes } from '#lib/i18n/catalog.ts';
import { LANG_COOKIE } from '#lib/i18n/languages.ts';
import { matchLanguage } from '#lib/i18n/resolve.ts';
import { loadPrefs, savePrefs } from '#lib/server/preferences/store.ts';
import type { RequestHandler } from './$types';

const bodySchema = z.object({ lang: z.string().max(20) });

/**
 * Choose the interface language: remembered in the `sma_lang` cookie and, for logged-in users, in the
 * `lang` user preference (like phpMyAdmin). Public: the login page uses it too.
 */
export const POST: RequestHandler = async ({ request, cookies, locals, url }) => {
	const parsed = bodySchema.safeParse(await request.json().catch(() => null));
	const lang = parsed.success ? matchLanguage(parsed.data.lang, availableCodes()) : null;
	if (!lang) error(400, 'Unknown language');

	const secure = url.protocol === 'https:';
	cookies.set(LANG_COOKIE, lang, {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: 60 * 60 * 24 * 365
	});

	let saved = false;
	if (locals.session) {
		try {
			const prefs = await loadPrefs(locals, cookies);
			saved = (await savePrefs(locals, cookies, { ...prefs.data, lang }, secure)) === null;
		} catch {
			// The cookie already holds the choice; a failing configuration storage must not break switching.
		}
	}
	return Response.json({ lang, saved });
};
