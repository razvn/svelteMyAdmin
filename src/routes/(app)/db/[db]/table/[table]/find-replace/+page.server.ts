import { fail } from '@sveltejs/kit';
import {
	describeError,
	loadReplaceColumns,
	previewReplace,
	requestSchema,
	runReplace
} from '#lib/server/table/find-replace.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const dbi = await locals.dbi;
	return { columns: await loadReplaceColumns(dbi, params.db, params.table) };
};

async function parse(request: Request) {
	const form = await request.formData();
	const values = {
		column: String(form.get('column') ?? ''),
		find: String(form.get('find') ?? ''),
		replaceWith: String(form.get('replaceWith') ?? ''),
		useRegex: form.get('useRegex') === 'on'
	};
	return { values, parsed: requestSchema.safeParse(values) };
}

export const actions: Actions = {
	preview: async ({ request, params, locals }) => {
		const { values, parsed } = await parse(request);
		if (!parsed.success)
			return fail(400, { values, error: locals.i18n.t(parsed.error.issues[0].message) });
		try {
			const dbi = await locals.dbi;
			return { values, preview: await previewReplace(dbi, params.db, params.table, parsed.data) };
		} catch (e) {
			return fail(400, { values, error: describeError(e, locals.i18n) });
		}
	},
	replace: async ({ request, params, locals }) => {
		const { values, parsed } = await parse(request);
		if (!parsed.success)
			return fail(400, { values, error: locals.i18n.t(parsed.error.issues[0].message) });
		try {
			const dbi = await locals.dbi;
			return { values, replaced: await runReplace(dbi, params.db, params.table, parsed.data) };
		} catch (e) {
			return fail(400, { values, error: describeError(e, locals.i18n) });
		}
	}
};
