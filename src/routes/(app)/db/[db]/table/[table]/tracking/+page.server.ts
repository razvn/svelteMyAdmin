import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import {
	createVersion,
	deleteTracking,
	getTrackedData,
	getVersion,
	listVersions,
	normaliseTrackingSet,
	saveLog,
	setActive
} from '#lib/server/pmadb/tracking.ts';
import { withTracking } from '#lib/server/pmadb/tracking-ctx.ts';
import { entriesToSql } from '#lib/tracking/analyse.ts';
import { reportEntries, reportParams } from '#lib/tracking/report.ts';
import type { Actions, PageServerLoad } from './$types';

const versionNo = z.coerce.number().int().min(1).max(4_294_967_295);

export const load: PageServerLoad = async ({ locals, params, url, parent }) => {
	const { tableType } = await parent();
	const { db, table } = params;
	const defaults = locals.server.tracking_default_statements;
	const q = url.searchParams;
	const wantVersion = versionNo.safeParse(q.get('version'));
	const view: 'report' | 'snapshot' | null = !wantVersion.success
		? null
		: q.has('snapshot')
			? 'snapshot'
			: q.has('report')
				? 'report'
				: null;
	const filter = reportParams((k) => q.get(k));

	const res = await withTracking(locals, async (ctx) => {
		const versions = await listVersions(ctx, db, table);
		const data =
			view && wantVersion.success ? await getTrackedData(ctx, db, table, wantVersion.data) : null;
		return { versions, data };
	});
	if (!res.ok) {
		return { available: false as const, db, table, error: res.error, defaults };
	}
	const { versions, data } = res.value;
	const entries = data ? reportEntries(data.ddlog, data.dmlog, filter.logtype, filter) : [];
	const dump = view === 'report' && q.get('export') === 'sqldump' ? entriesToSql(entries) : null;
	return {
		available: true as const,
		db,
		table,
		isView: tableType === 'view',
		defaults,
		versions,
		nextVersion: (versions[0]?.version ?? 0) + 1,
		view: data ? view : null,
		version: wantVersion.success ? wantVersion.data : null,
		filter,
		tracking: data?.tracking ?? '',
		ddl: data ? reportEntries(data.ddlog, [], 'schema', filter) : [],
		dml: data ? reportEntries([], data.dmlog, 'data', filter) : [],
		dateFrom: data?.dateFrom ?? '',
		dateTo: data?.dateTo ?? '',
		snapshot: data?.snapshot ?? null,
		createStatement:
			data?.ddlog
				.slice(0, 2)
				.map((e) => e.statement)
				.join('\n') ?? '',
		dump
	};
};

export const actions: Actions = {
	create: async ({ request, locals, params }) => {
		const fd = await request.formData();
		const version = versionNo.safeParse(fd.get('version'));
		if (!version.success) return fail(400, { error: locals.i18n.t('Invalid version.') });
		const dbi = await locals.dbi;
		const src = await locals.db;
		const type = await dbi.getTableType(params.db, params.table);
		const res = await withTracking(locals, async (ctx) => {
			if ((await getVersion(ctx, params.db, params.table)) >= version.data) {
				throw new Error(
					locals.i18n.t('Version {version} already exists or is older than the last one.', {
						version: version.data
					})
				);
			}
			await createVersion(ctx, src, {
				db: params.db,
				table: params.table,
				version: version.data,
				trackingSet: normaliseTrackingSet(fd.getAll('statement').map(String).join(',')),
				isView: type === 'VIEW'
			});
		});
		if (!res.ok) return fail(400, { error: res.error });
		return {
			message: locals.i18n.t('Version {version} was created, tracking for {table} is active.', {
				version: version.data,
				table: `${params.db}.${params.table}`
			})
		};
	},

	activate: async ({ request, locals, params }) => toggle(request, locals, params, true),
	deactivate: async ({ request, locals, params }) => toggle(request, locals, params, false),

	deleteVersion: async ({ request, locals, params }) => {
		const version = versionNo.safeParse((await request.formData()).get('version'));
		if (!version.success) return fail(400, { error: locals.i18n.t('Invalid version.') });
		const res = await withTracking(locals, (ctx) =>
			deleteTracking(ctx, params.db, params.table, version.data)
		);
		if (!res.ok) return fail(400, { error: res.error });
		return {
			message: locals.i18n.t('Version {version} of {table} was deleted.', {
				version: version.data,
				table: `${params.db}.${params.table}`
			})
		};
	},

	/** Remove one row of the DDL / DML log. */
	deleteLog: async ({ request, locals, params }) => {
		const fd = await request.formData();
		const version = versionNo.safeParse(fd.get('version'));
		const which = fd.get('which') === 'ddl' ? 'ddl' : 'dml';
		const id = Number(fd.get('id'));
		if (!version.success || !Number.isInteger(id) || id < 0) {
			return fail(400, { error: locals.i18n.t('Invalid request.') });
		}
		const res = await withTracking(locals, async (ctx) => {
			const data = await getTrackedData(ctx, params.db, params.table, version.data);
			if (!data) throw new Error(locals.i18n.t('Version not found.'));
			const log = which === 'ddl' ? data.ddlog : data.dmlog;
			await saveLog(
				ctx,
				params.db,
				params.table,
				version.data,
				which,
				log.filter((_, i) => i !== id)
			);
		});
		if (!res.ok) return fail(400, { error: res.error });
		return {
			message:
				which === 'ddl'
					? locals.i18n.t('Tracking data definition successfully deleted')
					: locals.i18n.t('Tracking data manipulation successfully deleted')
		};
	},

	/** Run the dump of the report (statements of the filtered report) as SQL. */
	execute: async ({ request, locals, params }) => {
		const fd = await request.formData();
		const version = versionNo.safeParse(fd.get('version'));
		if (!version.success) return fail(400, { error: locals.i18n.t('Invalid version.') });
		const filter = reportParams((k) => fd.get(k)?.toString());
		const entries = await withTracking(locals, async (ctx) => {
			const data = await getTrackedData(ctx, params.db, params.table, version.data);
			if (!data) throw new Error(locals.i18n.t('Version not found.'));
			return reportEntries(data.ddlog, data.dmlog, filter.logtype, filter);
		});
		if (!entries.ok) return fail(400, { error: entries.error });
		const conn = await locals.db;
		try {
			await conn.query(`USE \`${params.db.replaceAll('`', '``')}\``);
			for (const e of entries.value) await conn.query(`/*NOTRACK*/\n${e.statement}`);
		} catch (e) {
			return fail(400, {
				error: (e as { sqlMessage?: string }).sqlMessage ?? locals.i18n.t('Execution failed.')
			});
		}
		return {
			message: locals.i18n.tn(
				'{n} statement executed.',
				'{n} statements executed.',
				entries.value.length
			)
		};
	}
};

async function toggle(
	request: Request,
	locals: App.Locals,
	params: { db: string; table: string },
	active: boolean
) {
	const version = versionNo.safeParse((await request.formData()).get('version'));
	if (!version.success) return fail(400, { error: locals.i18n.t('Invalid version.') });
	const res = await withTracking(locals, (ctx) =>
		setActive(ctx, params.db, params.table, version.data, active)
	);
	if (!res.ok) return fail(400, { error: res.error });
	return {
		message: active
			? locals.i18n.t('Tracking for {table} was activated at version {version}.', {
					table: `${params.db}.${params.table}`,
					version: version.data
				})
			: locals.i18n.t('Tracking for {table} was deactivated at version {version}.', {
					table: `${params.db}.${params.table}`,
					version: version.data
				})
	};
}
