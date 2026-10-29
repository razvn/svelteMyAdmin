import { error } from '@sveltejs/kit';
import { exportQuerySchema, exportSchema } from '#lib/server/designer/export.ts';
import { designerTables } from '#lib/server/designer/storage.ts';
import { withControl } from '#lib/server/table/control.ts';
import type { RelationServer } from '#lib/server/table/relation.ts';
import type { RequestHandler } from './$types';

/** Schema export (PDF / SVG) of a Designer page. */
export const GET: RequestHandler = async ({ locals, params, url }) => {
	const parsed = exportQuerySchema.safeParse(Object.fromEntries(url.searchParams));
	if (!parsed.success) error(400, locals.i18n.t('Invalid export options.'));
	const dbi = await locals.dbi;
	if (!(await dbi.databaseExists(params.db))) error(404, locals.i18n.t('Database not found.'));
	const tables = designerTables(locals.server);
	const run = (storage: Parameters<typeof exportSchema>[4]) =>
		exportSchema(dbi, locals.server as RelationServer, params.db, parsed.data, storage);
	const file =
		tables && parsed.data.page > 0
			? await withControl(locals, (conn) => run({ conn, tables }))
			: await run(null);
	if (!file) error(500, locals.i18n.t('The configuration storage is not reachable.'));
	const name = `${params.db.replace(/[^\w.-]/g, '_')}.${file.extension}`;
	const body = typeof file.body === 'string' ? file.body : new Uint8Array(file.body);
	return new Response(body, {
		headers: {
			'content-type': file.mimeType,
			'content-disposition': `${url.searchParams.get('download') ? 'attachment' : 'inline'}; filename="${name}"`
		}
	});
};
