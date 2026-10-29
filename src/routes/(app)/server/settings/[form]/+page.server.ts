import { error, fail, redirect } from '@sveltejs/kit';
import { loadFormPage, saveForm } from '#lib/server/preferences/page.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, cookies, params, url }) => {
	const page = await loadFormPage(locals, cookies, params.form);
	if (!page) error(404, 'Page not found');
	return { ...page, saved: url.searchParams.has('saved') };
};

export const actions: Actions = {
	save: async ({ request, locals, cookies, params, url }) => {
		if (!(await loadFormPage(locals, cookies, params.form))) error(404, 'Page not found');
		const res = await saveForm(
			locals,
			cookies,
			params.form,
			await request.formData(),
			url.protocol === 'https:'
		);
		if (!res.ok) {
			return fail(400, { errors: res.errors, values: res.values, message: res.message ?? null });
		}
		redirect(303, `/server/settings/${params.form}?saved`);
	}
};
