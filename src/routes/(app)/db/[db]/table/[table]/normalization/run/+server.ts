import { error } from '@sveltejs/kit';
import { z } from 'zod';
import {
	findPartialDependencies,
	loadTableInfo,
	runOperation
} from '#lib/server/table/normalization.ts';
import type { RequestHandler } from './$types';

const body = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('info'), table: z.string().min(1).max(64) }),
	z.object({ kind: z.literal('pd'), table: z.string().min(1).max(64).optional() }),
	z.object({ kind: z.literal('op'), op: z.unknown() })
]);

/** JSON API of the wizard: table info, data based partial dependencies, and the executing steps. */
export const POST: RequestHandler = async ({ request, locals, params }) => {
	const parsed = body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, locals.i18n.t('Invalid request'));
	const dbi = await locals.dbi;
	const { db, table } = params;
	const b = parsed.data;
	if (b.kind === 'info') {
		const info = await loadTableInfo(dbi, db, b.table);
		if (!info) error(404, locals.i18n.t('Table not found'));
		return Response.json({ info });
	}
	if (b.kind === 'pd') {
		return Response.json({
			dependencies: await findPartialDependencies(dbi, db, b.table ?? table)
		});
	}
	return Response.json(await runOperation(dbi, db, table, b.op, false, locals.i18n));
};
