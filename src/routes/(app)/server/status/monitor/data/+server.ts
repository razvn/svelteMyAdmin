import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { getChartingData } from '#lib/server/admin/monitor.ts';
import { DataPointSchema } from '#lib/monitor/types.ts';
import type { RequestHandler } from './$types';

const body = z.object({ points: z.array(DataPointSchema).min(1).max(100) });

/** Real-time charting data (Monitor::getJsonForChartingData): current values of the requested points. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const parsed = body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, locals.i18n.t('Invalid request'));
	const data = await getChartingData(await locals.db, parsed.data.points);
	return Response.json(data, { headers: { 'cache-control': 'no-store' } });
};
