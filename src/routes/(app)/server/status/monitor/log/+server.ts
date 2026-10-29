import { error } from '@sveltejs/kit';
import { z } from 'zod';
import {
	getGeneralLog,
	getLoggingVars,
	getSlowLog,
	logsToTable
} from '#lib/server/admin/monitor.ts';
import type { RequestHandler } from './$types';

const body = z.object({
	type: z.enum(['slow', 'general']),
	/** Unix seconds. */
	start: z.number().int().nonnegative(),
	end: z.number().int().nonnegative(),
	limitTypes: z.boolean().default(false),
	groupInserts: z.boolean().default(false)
});

const sqlMessage = (e: unknown, fallback: string) =>
	e && typeof e === 'object' && 'sqlMessage' in e
		? String((e as { sqlMessage: unknown }).sqlMessage)
		: fallback;

/** Log entries of a time range from mysql.slow_log / mysql.general_log (needs log_output to include TABLE). */
export const POST: RequestHandler = async ({ request, locals }) => {
	const parsed = body.safeParse(await request.json().catch(() => null));
	if (!parsed.success || parsed.data.end < parsed.data.start) error(400, locals.i18n.t('Invalid request'));
	const { type, start, end, limitTypes, groupInserts } = parsed.data;
	const conn = await locals.db;
	const headers = { 'cache-control': 'no-store' };
	if (!logsToTable(await getLoggingVars(conn))) {
		return Response.json(
			{ error: locals.i18n.t('log_output does not include TABLE, the log tables are not filled.') },
			{ status: 400, headers }
		);
	}
	try {
		const result =
			type === 'slow'
				? await getSlowLog(conn, start, end)
				: await getGeneralLog(conn, start, end, limitTypes, groupInserts);
		return Response.json({ type, ...result }, { headers });
	} catch (e) {
		return Response.json({ error: sqlMessage(e, locals.i18n.t('Failed to read the log table')) }, { status: 400, headers });
	}
};
