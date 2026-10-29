import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { analyzeQuery } from '#lib/server/admin/monitor.ts';
import type { RequestHandler } from './$types';

const body = z.object({
	database: z.string().max(64).default(''),
	query: z.string().min(1).max(100_000)
});

/** "Analyse query": EXPLAIN (+ profiling for SELECT), Monitor::getJsonForQueryAnalyzer. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const parsed = body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, 'Invalid request');
	const result = await analyzeQuery(await locals.db, parsed.data.database, parsed.data.query);
	return Response.json(result, { headers: { 'cache-control': 'no-store' } });
};
