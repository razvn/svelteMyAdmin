import { fail, redirect } from '@sveltejs/kit';
import { exportJson } from '#lib/preferences/logic.ts';
import { importPrefs, resetPrefs, storageInfo } from '#lib/server/preferences/page.ts';
import { loadPrefs } from '#lib/server/preferences/store.ts';
import type { Actions, PageServerLoad } from './$types';

/** Upload cap for a settings file (a full export is a few KB). */
const MAX_IMPORT_BYTES = 512 * 1024;

export const load: PageServerLoad = async ({ locals, cookies, url }) => {
	const prefs = await loadPrefs(locals, cookies);
	// the 2fa entry holds the TOTP secret: never shown in the export box
	const visible = { ...prefs.data };
	delete visible['2fa'];
	return {
		storage: storageInfo(prefs),
		count: Object.keys(visible).length,
		json: exportJson(visible),
		saved: url.searchParams.get('saved'),
		dropped: url.searchParams.get('dropped')
	};
};

export const actions: Actions = {
	import: async ({ request, locals, cookies, url }) => {
		const fd = await request.formData();
		const file = fd.get('import_file');
		const merge = fd.get('import_merge') === '1';
		let text = '';
		if (file instanceof File && file.size > 0) {
			if (file.size > MAX_IMPORT_BYTES) return fail(400, { error: 'The file is too large.' });
			text = await file.text();
		} else if (typeof fd.get('json') === 'string') {
			text = fd.get('json') as string;
		}
		if (text.trim() === '') return fail(400, { error: 'Could not import configuration' });
		const res = await importPrefs(locals, cookies, text, merge, url.protocol === 'https:');
		if (!res.ok) return fail(400, { error: res.error ?? 'Could not import configuration' });
		const dropped = res.dropped?.length
			? `&dropped=${encodeURIComponent(res.dropped.join(', '))}`
			: '';
		redirect(303, `/server/settings?saved=import${dropped}`);
	},
	reset: async ({ locals, cookies, url }) => {
		const error = await resetPrefs(locals, cookies, url.protocol === 'https:');
		if (error) return fail(500, { error });
		redirect(303, '/server/settings?saved=reset');
	}
};
