import { error } from '@sveltejs/kit';
import { GisError, loadGisData, type GisData } from '#lib/server/table/gis.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url, parent }) => {
	await parent();
	const dbi = await locals.dbi;
	const q = url.searchParams;
	const sql = q.get('sql');
	try {
		const gis = await loadGisData(dbi, params.db, params.table, {
			sql,
			geometryColumn: q.get('col') ?? undefined,
			labelColumn: q.get('label') ?? undefined,
			limit: Number(q.get('limit')) || undefined,
			offset: Number(q.get('offset')) || undefined
		});
		return { db: params.db, table: params.table, sql: sql ?? '', gis, loadError: '' };
	} catch (e) {
		if (!(e instanceof GisError)) error(500, 'The geometry data could not be loaded.');
		const empty: GisData = {
			spatialColumns: [],
			columns: [],
			geometryColumn: '',
			labelColumn: '',
			rows: [],
			total: 0,
			limit: 1000,
			offset: 0
		};
		return { db: params.db, table: params.table, sql: sql ?? '', gis: empty, loadError: e.message };
	}
};
