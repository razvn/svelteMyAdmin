import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import {
	dropEvent,
	exportEvent,
	getEvent,
	getSchedulerState,
	listEvents,
	saveEvent,
	setScheduler
} from '#lib/server/database/events.ts';
import { eventDefSchema, parseJsonField } from '#lib/server/database/schemas.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const conn = await locals.db;
	return {
		events: await listEvents(conn, params.db),
		scheduler: await getSchedulerState(conn),
		highlight: url.searchParams.get('item')
	};
};

const nameSchema = z.object({ name: z.string().min(1).max(64) });

export const actions: Actions = {
	get: async ({ request, params, locals }) => {
		const ref = nameSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!ref.success) return fail(400, { error: 'Invalid event.' });
		const event = await getEvent(await locals.db, params.db, ref.data.name);
		if (!event) return fail(404, { error: `No event with name ${ref.data.name} found.` });
		return { event };
	},

	export: async ({ request, params, locals }) => {
		const ref = nameSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!ref.success) return fail(400, { error: 'Invalid event.' });
		try {
			const sql = await exportEvent(await locals.db, params.db, ref.data.name);
			if (sql === null) return fail(404, { error: 'The event definition is not available.' });
			return { sql };
		} catch {
			return fail(400, { error: 'The event could not be exported.' });
		}
	},

	save: async ({ request, params, locals }) => {
		const form = await request.formData();
		const def = parseJsonField(eventDefSchema, form.get('payload'));
		if (!def) return fail(400, { error: 'Invalid event data.' });
		const original = form.get('original');
		const result = await saveEvent(
			await locals.db,
			params.db,
			def,
			typeof original === 'string' && original !== '' ? original : null
		);
		if (!result.ok) return fail(400, { error: result.errors.join(' '), errors: result.errors });
		return { saved: def.name, queries: result.queries };
	},

	drop: async ({ request, params, locals }) => {
		const ref = nameSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!ref.success) return fail(400, { error: 'Invalid event.' });
		const result = await dropEvent(await locals.db, params.db, ref.data.name);
		if (!result.ok) return fail(400, { error: result.error ?? 'Drop failed.' });
		return { dropped: ref.data.name, query: result.query };
	},

	/** Toggle the global event scheduler (needs SUPER / SYSTEM_VARIABLES_ADMIN). */
	scheduler: async ({ request, locals }) => {
		const parsed = z
			.object({ state: z.enum(['ON', 'OFF']) })
			.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success) return fail(400, { error: 'Invalid state.' });
		const conn = await locals.db;
		const state = await getSchedulerState(conn);
		if (!state.canToggle) {
			return fail(403, { error: 'You do not have the privilege to change the event scheduler.' });
		}
		const result = await setScheduler(conn, parsed.data.state === 'ON');
		if (!result.ok) return fail(400, { error: result.error ?? 'Failed.' });
		return { scheduler: parsed.data.state, query: result.query };
	}
};
