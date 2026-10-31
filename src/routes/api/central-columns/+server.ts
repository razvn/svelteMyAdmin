import { error } from '@sveltejs/kit';
import { z } from 'zod';
import { withRepo } from '#lib/server/storage/index.ts';
import type { RequestHandler } from './$types';

const query = z.object({ db: z.string().min(1).max(64) });

/** The central columns of a database (empty when the feature is not available). */
export const GET: RequestHandler = async ({ url, locals }) => {
	const parsed = query.safeParse({ db: url.searchParams.get('db') });
	if (!parsed.success) error(400, 'Invalid request');
	const columns =
		(await withRepo(locals, 'centralColumns', (repo) => repo.list(parsed.data.db))) ?? [];
	return Response.json({ columns }, { headers: { 'cache-control': 'no-store' } });
};
