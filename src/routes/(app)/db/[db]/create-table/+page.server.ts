import { fail } from '@sveltejs/kit';
import {
	createTable,
	getCreateTableContext,
	parseNumFields
} from '#lib/server/database/create-table.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const dbi = await locals.dbi;
	const ctx = await getCreateTableContext(dbi);
	return {
		...ctx,
		initialName: (url.searchParams.get('name') ?? '').slice(0, 64),
		numFields: parseNumFields(url.searchParams.get('num_fields'))
	};
};

export const actions: Actions = {
	create: async ({ request, locals, params }) => {
		const form = await request.formData();
		let input: unknown;
		try {
			input = JSON.parse(String(form.get('definition') ?? ''));
		} catch {
			return fail(400, { error: 'Invalid table definition.' });
		}
		const dbi = await locals.dbi;
		const res = await createTable(dbi, params.db, input);
		if (!res.ok) return fail(400, { error: res.error });
		return { created: res.table };
	}
};
