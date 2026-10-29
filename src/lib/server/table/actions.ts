/**
 * Glue between SvelteKit form actions and the structure services: parse the JSON `payload` field,
 * refuse views, run the service and turn its result into an action result.
 */
import { fail, type Action, type RequestEvent } from '@sveltejs/kit';
import type { Translator } from '#lib/i18n/translator.ts';
import type { DatabaseInterface } from '../db/dbi';
import type { ActionResult } from './structure';

export interface TableCtx {
	dbi: DatabaseInterface;
	db: string;
	table: string;
	tr: Translator;
}

export function alterAction(
	run: (ctx: TableCtx, payload: unknown, event: RequestEvent) => Promise<ActionResult>
): Action {
	return async (event) => {
		const form = await event.request.formData();
		let payload: unknown;
		try {
			payload = JSON.parse(String(form.get('payload') ?? ''));
		} catch {
			return fail(400, { error: event.locals.i18n.t('Invalid request.') });
		}
		const dbi = await event.locals.dbi;
		const { db, table } = event.params as { db: string; table: string };
		const type = await dbi.getTableType(db, table);
		if (type === null) return fail(404, { error: event.locals.i18n.t('Table not found.') });
		if (type === 'VIEW' || type === 'SYSTEM VIEW') {
			return fail(400, {
				error: event.locals.i18n.t('This is a view: its structure cannot be altered here.')
			});
		}
		const res = await run({ dbi, db, table, tr: event.locals.i18n }, payload, event);
		if (!res.ok) return fail(400, { error: res.error, sql: res.sql });
		return { done: res.sql };
	};
}
