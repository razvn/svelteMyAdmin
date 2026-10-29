import { fail } from '@sveltejs/kit';
import { connectionId, killProcess, listProcesses } from '#lib/server/admin/processes.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const conn = await locals.db;
	const [processes, ownId] = await Promise.all([listProcesses(conn), connectionId(conn)]);
	return { processes, ownId };
};

export const actions: Actions = {
	kill: async ({ locals, request }) => {
		const form = await request.formData();
		const result = await killProcess(await locals.db, form.get('id'), locals.i18n);
		if (!result.ok) return fail(400, { killError: result.message });
		return { killed: Number(form.get('id')) };
	}
};
