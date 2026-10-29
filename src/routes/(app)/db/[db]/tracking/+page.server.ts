import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { N_ } from '#lib/i18n/translator.ts';
import {
	createVersion,
	deleteTracking,
	getTrackedData,
	getVersion,
	listTrackedTables,
	normaliseTrackingSet
} from '#lib/server/pmadb/tracking.ts';
import { withTracking } from '#lib/server/pmadb/tracking-ctx.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const dbi = await locals.dbi;
	const tables = await dbi.listTables(params.db);
	const res = await withTracking(locals, async (ctx) => {
		const tracked = await listTrackedTables(ctx, params.db);
		const dbData = await getTrackedData(ctx, params.db, '', 1);
		return { tracked, log: dbData?.ddlog ?? [] };
	});
	const defaults = locals.server.tracking_default_statements;
	if (!res.ok) return { available: false as const, db: params.db, error: res.error, defaults };
	const trackedNames = new Set(res.value.tracked.map((tbl) => tbl.table));
	return {
		available: true as const,
		db: params.db,
		defaults,
		tracked: res.value.tracked,
		untracked: tables.filter((tbl) => !trackedNames.has(tbl.name)).map((tbl) => tbl.name),
		log: res.value.log
	};
};

const versionForm = z.object({
	version: z.coerce.number().int().min(1).max(4_294_967_295),
	tables: z.array(z.string().min(1).max(64)).min(1, N_('No tables selected.')),
	statements: z.array(z.string())
});

const tableNames = (fd: FormData) =>
	fd
		.getAll('table')
		.map(String)
		.filter((n) => n !== '');

export const actions: Actions = {
	track: async ({ request, locals, params }) => {
		const fd = await request.formData();
		const parsed = versionForm.safeParse({
			version: fd.get('version'),
			tables: tableNames(fd),
			statements: fd.getAll('statement').map(String)
		});
		if (!parsed.success) return fail(400, { error: locals.i18n.t(parsed.error.issues[0].message) });
		const { version, tables, statements } = parsed.data;
		const src = await locals.db;
		const dbi = await locals.dbi;
		const res = await withTracking(locals, async (ctx) => {
			for (const table of tables) {
				if ((await getVersion(ctx, params.db, table)) >= version) {
					throw new Error(
						locals.i18n.t('Version {version} of {table} already exists or is older.', {
							version,
							table
						})
					);
				}
				const type = await dbi.getTableType(params.db, table);
				await createVersion(ctx, src, {
					db: params.db,
					table,
					version,
					trackingSet: normaliseTrackingSet(statements.join(',')),
					isView: type === 'VIEW'
				});
			}
		});
		if (!res.ok) return fail(400, { error: res.error });
		return {
			message: locals.i18n.t(
				'Version {version} was created for the selected tables, tracking is active for them.',
				{ version }
			)
		};
	},

	deleteTracking: async ({ request, locals, params }) => {
		const tables = tableNames(await request.formData());
		if (tables.length === 0) return fail(400, { error: locals.i18n.t('No tables selected.') });
		const res = await withTracking(locals, async (ctx) => {
			for (const tbl of tables) await deleteTracking(ctx, params.db, tbl);
		});
		if (!res.ok) return fail(400, { error: res.error });
		return { message: locals.i18n.t('Tracking data deleted successfully.') };
	}
};
