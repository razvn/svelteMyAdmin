import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import {
	dropRoutine,
	executeRoutine,
	exportRoutine,
	getRoutine,
	listRoutines,
	saveRoutine
} from '#lib/server/database/routines.ts';
import {
	executeParamsSchema,
	parseJsonField,
	routineDefSchema,
	routineTypeSchema
} from '#lib/server/database/schemas.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const conn = await locals.db;
	const type = routineTypeSchema.safeParse(url.searchParams.get('type'));
	return {
		routines: await listRoutines(conn, params.db),
		highlight: {
			type: type.success ? type.data : null,
			item: url.searchParams.get('item')
		}
	};
};

const refSchema = z.object({ type: routineTypeSchema, name: z.string().min(1).max(64) });

export const actions: Actions = {
	/** Routine definition for the editor / execute dialog. */
	get: async ({ request, params, locals }) => {
		const ref = refSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!ref.success) return fail(400, { error: 'Invalid routine.' });
		const routine = await getRoutine(await locals.db, params.db, ref.data.type, ref.data.name);
		if (!routine) {
			return fail(404, {
				error: `No routine with name ${ref.data.name} found in database ${params.db}.`
			});
		}
		return { routine };
	},

	export: async ({ request, params, locals }) => {
		const ref = refSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!ref.success) return fail(400, { error: 'Invalid routine.' });
		try {
			const sql = await exportRoutine(await locals.db, params.db, ref.data.type, ref.data.name);
			if (sql === null) return fail(404, { error: 'The routine definition is not available.' });
			return { sql };
		} catch {
			return fail(400, { error: 'The routine could not be exported.' });
		}
	},

	save: async ({ request, params, locals }) => {
		const form = await request.formData();
		const def = parseJsonField(routineDefSchema, form.get('payload'));
		if (!def) return fail(400, { error: 'Invalid routine data.' });
		const original = form.get('original');
		let originalRef: z.infer<typeof refSchema> | null = null;
		if (typeof original === 'string' && original !== '') {
			originalRef = parseJsonField(refSchema, original);
			if (!originalRef) return fail(400, { error: 'Invalid routine data.' });
		}
		const result = await saveRoutine(await locals.db, params.db, def, originalRef);
		if (!result.ok) return fail(400, { error: result.errors.join(' '), errors: result.errors });
		return { saved: def.name, queries: result.queries };
	},

	drop: async ({ request, params, locals }) => {
		const ref = refSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!ref.success) return fail(400, { error: 'Invalid routine.' });
		const result = await dropRoutine(await locals.db, params.db, ref.data.type, ref.data.name);
		if (!result.ok) return fail(400, { error: result.error ?? 'Drop failed.' });
		return { dropped: ref.data.name, query: result.query };
	},

	execute: async ({ request, params, locals }) => {
		const form = await request.formData();
		const ref = refSchema.safeParse({ type: form.get('type'), name: form.get('name') });
		const args = parseJsonField(executeParamsSchema, form.get('params'));
		if (!ref.success || !args) return fail(400, { error: 'Invalid request.' });
		const result = await executeRoutine(
			await locals.db,
			params.db,
			ref.data.type,
			ref.data.name,
			args
		);
		return { result };
	}
};
