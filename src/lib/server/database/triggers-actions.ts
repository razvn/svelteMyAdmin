/**
 * Shared load/actions for the trigger list at database level and at table level (optional table filter).
 */
import { fail, type Action } from '@sveltejs/kit';
import { z } from 'zod';
import { parseJsonField, triggerDefSchema } from './schemas';
import { dropTrigger, exportTrigger, getTrigger, listTriggers, saveTrigger } from './triggers';
import type { Connection } from '../db/connection';
import { rows, str } from './common';

type Ctx = { params: { db: string; table?: string }; locals: App.Locals; request: Request };

const nameSchema = z.object({ name: z.string().min(1).max(64) });

export async function loadTriggers(ctx: Pick<Ctx, 'params' | 'locals'>) {
	const conn = await ctx.locals.db;
	const { db, table } = ctx.params;
	return {
		triggers: await listTriggers(conn, db, table),
		tables: await listTableNames(conn, db),
		fixedTable: table ?? null
	};
}

async function listTableNames(conn: Connection, db: string): Promise<string[]> {
	const r = await rows(
		conn,
		"SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
		[db]
	);
	return r.map((x) => str(x.name));
}

/** Build the action map; `Action` is typed loosely so both route files can use it. */
export function triggerActions() {
	const get: Action = async ({ request, params, locals }) => {
		const ref = nameSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!ref.success) return fail(400, { error: locals.i18n.t('Invalid trigger.') });
		const trigger = await getTrigger(await locals.db, params.db!, ref.data.name, params.table);
		if (!trigger)
			return fail(404, {
				error: locals.i18n.t('No trigger with name {name} found.', { name: ref.data.name })
			});
		return { trigger };
	};
	const exportAction: Action = async ({ request, params, locals }) => {
		const ref = nameSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!ref.success) return fail(400, { error: locals.i18n.t('Invalid trigger.') });
		try {
			const sql = await exportTrigger(await locals.db, params.db!, ref.data.name);
			if (sql === null)
				return fail(404, { error: locals.i18n.t('The trigger definition is not available.') });
			return { sql };
		} catch {
			return fail(400, { error: locals.i18n.t('The trigger could not be exported.') });
		}
	};
	const save: Action = async ({ request, params, locals }) => {
		const form = await request.formData();
		const def = parseJsonField(triggerDefSchema, form.get('payload'));
		if (!def) return fail(400, { error: locals.i18n.t('Invalid trigger data.') });
		if (params.table !== undefined) def.table = params.table;
		const original = form.get('original');
		const result = await saveTrigger(
			await locals.db,
			params.db!,
			def,
			typeof original === 'string' && original !== '' ? original : null,
			locals.i18n
		);
		if (!result.ok) return fail(400, { error: result.errors.join(' '), errors: result.errors });
		return { saved: def.name, queries: result.queries };
	};
	const drop: Action = async ({ request, params, locals }) => {
		const ref = nameSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!ref.success) return fail(400, { error: locals.i18n.t('Invalid trigger.') });
		const result = await dropTrigger(await locals.db, params.db!, ref.data.name);
		if (!result.ok) return fail(400, { error: result.error ?? locals.i18n.t('Drop failed.') });
		return { dropped: ref.data.name, query: result.query };
	};
	return { get, export: exportAction, save, drop };
}
