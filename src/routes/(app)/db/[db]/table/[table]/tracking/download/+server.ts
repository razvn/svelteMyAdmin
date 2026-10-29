import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { getTrackedData } from '#lib/server/pmadb/tracking.ts';
import { withTracking } from '#lib/server/pmadb/tracking-ctx.ts';
import { entriesToSql, formatDate } from '#lib/tracking/analyse.ts';
import { reportEntries, reportParams } from '#lib/tracking/report.ts';
import type { RequestHandler } from './$types';

/** Tracking::exportAsFileDownload: the filtered report as `log_<table>.sql`. */
export const GET: RequestHandler = async ({ url, locals, params }) => {
	const version = z.coerce.number().int().min(1).safeParse(url.searchParams.get('version'));
	if (!version.success) error(400, 'Invalid version');
	const filter = reportParams((k) => url.searchParams.get(k));
	const res = await withTracking(locals, async (ctx) => {
		const data = await getTrackedData(ctx, params.db, params.table, version.data);
		return data ? reportEntries(data.ddlog, data.dmlog, filter.logtype, filter) : null;
	});
	if (!res.ok) error(503, res.error);
	if (!res.value) error(404, 'Version not found');
	const table = params.table.replace(/\s+/g, ' ');
	const dump = `# Tracking report for table \`${table}\`\n# ${formatDate()}\n${entriesToSql(res.value)}\n`;
	return new Response(dump, {
		headers: {
			'content-type': 'text/x-sql; charset=utf-8',
			'content-disposition': `attachment; filename="log_${table.replace(/[^\w.-]/g, '_')}.sql"`,
			'cache-control': 'no-store'
		}
	});
};
