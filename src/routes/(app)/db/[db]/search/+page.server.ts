import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { deleteMatches, parseSearchRequest, searchTables } from '#lib/server/database/search.ts';
import { SEARCH_TYPES } from '#lib/sql/db-search.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const dbi = await locals.dbi;
	const tables = await dbi.listTables(params.db);
	const req = parseSearchRequest(url.searchParams);
	const submitted = url.searchParams.has('submit_search');
	// Before any submit every table is checked; after a submit exactly the checked ones.
	const checkedTables = submitted ? req.tables : tables.map((t) => t.name);

	let results: { rows: Awaited<ReturnType<typeof searchTables>>; total: number } | null = null;
	if (req.submitted) {
		const rows = await searchTables(dbi, params.db, tables, req);
		results = { rows, total: rows.reduce((sum, r) => sum + r.count, 0) };
	}

	return {
		db: params.db,
		tables: tables.map((t) => ({ name: t.name, isView: t.type !== 'BASE TABLE' })),
		searchTypes: SEARCH_TYPES,
		criteria: { ...req.criteria, checkedTables },
		results,
		searchTypeLabel: SEARCH_TYPES.find((t) => t.value === req.criteria.searchType)?.label ?? ''
	};
};

export const actions: Actions = {
	// Posted to the results URL itself so the criteria stay in the query string after the
	// enhanced submit (a `?/delete` action would replace the query and drop the results).
	default: async ({ request, url, locals, params }) => {
		const form = await request.formData();
		const req = parseSearchRequest(url.searchParams);
		const table = z.string().min(1).safeParse(form.get('table'));
		if (!req.submitted || !table.success) {
			return fail(400, {
				deleteError: locals.i18n.t('The search is incomplete, nothing was deleted.')
			});
		}

		const dbi = await locals.dbi;
		const tables = await dbi.listTables(params.db);
		const res = await deleteMatches(dbi, params.db, tables, req, table.data, locals.i18n);
		if (!res.ok) return fail(400, { deleteError: res.error, deleteTable: table.data });
		return { deleted: res.deleted, deleteTable: res.table };
	}
};
