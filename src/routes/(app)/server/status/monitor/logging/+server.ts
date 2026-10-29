import { error } from '@sveltejs/kit';
import { z } from 'zod';
import {
	LOGGING_VARS,
	getLoggingVars,
	logsToTable,
	setLoggingVar
} from '#lib/server/admin/monitor.ts';
import type { RequestHandler } from './$types';

const headers = { 'cache-control': 'no-store' };

const body = z.object({
	name: z.enum(LOGGING_VARS),
	value: z.string().min(1).max(40)
});

const sqlMessage = (e: unknown, fallback: string) =>
	e && typeof e === 'object' && 'sqlMessage' in e
		? String((e as { sqlMessage: unknown }).sqlMessage)
		: e instanceof Error
			? e.message
			: fallback;

/** Current slow / general log settings. */
export const GET: RequestHandler = async ({ locals }) => {
	const vars = await getLoggingVars(await locals.db);
	return Response.json({ vars, table: logsToTable(vars) }, { headers });
};

/** SET GLOBAL slow_query_log / general_log / long_query_time / log_output (Monitor::getJsonForLoggingVars). */
export const POST: RequestHandler = async ({ request, locals }) => {
	const parsed = body.safeParse(await request.json().catch(() => null));
	if (!parsed.success) error(400, locals.i18n.t('Invalid request'));
	try {
		const vars = await setLoggingVar(await locals.db, parsed.data.name, parsed.data.value);
		return Response.json({ vars, table: logsToTable(vars) }, { headers });
	} catch (e) {
		return Response.json(
			{ error: sqlMessage(e, locals.i18n.t('Failed')) },
			{ status: 400, headers }
		);
	}
};
