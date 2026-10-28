import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import {
	deleteSearch,
	listSavedSearches,
	loadQuerySchema,
	saveSearch
} from '#lib/server/database/query-schema.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const dbi = await locals.dbi;
	return {
		db: params.db,
		schema: await loadQuerySchema(dbi, locals, params.db),
		// null = configuration storage not available (the saved searches UI is hidden)
		savedSearches: await listSavedSearches(locals, params.db)
	};
};

const saveSchema = z.object({
	id: z.coerce.number().int().positive().optional(),
	name: z.string().trim().min(1).max(64),
	data: z
		.string()
		.max(100_000)
		.transform((s, ctx) => {
			try {
				const v = JSON.parse(s);
				if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
			} catch {
				// fall through
			}
			ctx.addIssue({ code: 'custom', message: 'Invalid search data' });
			return z.NEVER;
		})
});

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		const raw = Object.fromEntries(await request.formData());
		if (raw.id === '') delete raw.id;
		const parsed = saveSchema.safeParse(raw);
		if (!parsed.success) return fail(400, { searchError: 'Give the search a name.' });
		const res = await saveSearch(locals, params.db, parsed.data);
		if (!res.ok) return fail(400, { searchError: res.error });
		return { savedId: res.id };
	},
	delete: async ({ request, locals, params }) => {
		const id = z.coerce
			.number()
			.int()
			.positive()
			.safeParse((await request.formData()).get('id'));
		if (!id.success) return fail(400, { searchError: 'No search selected.' });
		const res = await deleteSearch(locals, params.db, id.data);
		if (!res.ok) return fail(400, { searchError: 'Could not delete the search.' });
		return { deleted: true };
	}
};
