import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import {
	listVariableRows,
	setGlobalVariable,
	variableErrorMessage
} from '#lib/server/admin/variables.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const conn = await locals.db;
	return { variables: await listVariableRows(conn) };
};

const saveSchema = z.object({
	name: z.string().min(1).max(64),
	value: z.string().max(1024)
});

export const actions: Actions = {
	/** Inline edit of a GLOBAL variable (phpMyAdmin SetVariableController). */
	save: async ({ request, locals }) => {
		const parsed = saveSchema.safeParse(Object.fromEntries(await request.formData()));
		if (!parsed.success)
			return fail(400, { error: locals.i18n.t('Invalid variable name or value.') });
		try {
			const saved = await setGlobalVariable(await locals.db, parsed.data.name, parsed.data.value);
			return { saved };
		} catch (err) {
			return fail(400, { error: variableErrorMessage(err, locals.i18n), name: parsed.data.name });
		}
	}
};
