import { fail } from '@sveltejs/kit';
import { isSystemSchema } from '#lib/server/admin/databases.ts';
import {
	buildPlan,
	executePlan,
	getStructure,
	loadRawTables,
	isViewType,
	parseOperation,
	parseQuery
} from '#lib/server/database/structure.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const dbi = await locals.dbi;
	const { config } = locals;
	const q = parseQuery(url.searchParams);
	const data = await getStructure(dbi, params.db, {
		sort: q.sort,
		sortOrder: q.sort_order,
		pos: q.pos,
		maxTableList: config.MaxTableList,
		maxExactCount: config.MaxExactCount,
		maxExactCountViews: config.MaxExactCountViews
	});
	return {
		db: params.db,
		isSystem: isSystemSchema(params.db),
		...data,
		sort: q.sort,
		sortOrder: q.sort_order,
		maxTableList: config.MaxTableList,
		showStats: config.ShowStats
	};
};

async function prepare(request: Request, locals: App.Locals, db: string, forExecution: boolean) {
	const parsed = parseOperation(await request.formData());
	if (!parsed.success) return { error: parsed.error.issues[0].message } as const;
	const input = parsed.data;
	const readOnly = input.op === 'show_create' || ['check', 'checksum'].includes(input.op);
	if (isSystemSchema(db) && !readOnly) {
		return { error: 'Tables of a system database cannot be modified.' } as const;
	}
	const dbi = await locals.dbi;
	const tables = (await loadRawTables(dbi, db)).map((t) => ({
		name: t.name,
		isView: isViewType(t.type)
	}));
	const res = buildPlan(input, tables, forExecution ? db : null);
	if (!res.ok) return { error: res.error } as const;
	return { dbi, input, plan: res.plan } as const;
}

export const actions: Actions = {
	/** SQL that an operation would run, shown in the confirmation dialog. */
	preview: async ({ request, locals, params }) => {
		const p = await prepare(request, locals, params.db, false);
		if ('error' in p) return fail(400, { error: p.error });
		return {
			preview: {
				op: p.input.op,
				statements: p.plan.statements,
				disableFk: p.plan.disableFk
			}
		};
	},
	run: async ({ request, locals, params }) => {
		const p = await prepare(request, locals, params.db, true);
		if ('error' in p) return fail(400, { error: p.error });
		const res = await executePlan(p.dbi, p.plan);
		if (!res.ok) return fail(400, { error: res.error, executed: res.executed });
		return {
			done: {
				op: p.input.op,
				executed: res.executed,
				results: res.results,
				count: p.input.selected.length
			}
		};
	}
};
