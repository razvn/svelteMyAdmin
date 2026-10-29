import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import {
	createMissingTables,
	createPmaDatabase,
	getStorageStatus
} from '#lib/server/pmadb/features.ts';
import type { Translator } from '#lib/i18n/translator.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const status = await getStorageStatus(locals);
	const dbi = await locals.dbi;
	const databases = await dbi.listDatabases();
	return {
		status,
		// Preselected for "Create the tables in another database" (phpMyAdmin's fixall_pmadb).
		currentDb: url.searchParams.get('db') ?? '',
		databases,
		controlUser: locals.server.controluser || null
	};
};

const dbName = z.string().min(1).max(64);

/** Errors of the create actions are shown on the page. */
function describe(e: unknown, t: Translator['t']): string {
	return e instanceof Error ? e.message : t('The statement failed.');
}

export const actions: Actions = {
	/** Relation::createPmaDatabase + fixPmaTables on the configured (or default) pmadb. */
	createPmadb: async ({ locals }) => {
		const status = await getStorageStatus(locals);
		const conn = await locals.db;
		try {
			await createPmaDatabase(conn, status.pmadb);
			const created = await createMissingTables(conn, status.pmadb, locals.server);
			return { created, db: status.pmadb, configured: status.configured };
		} catch (e) {
			return fail(400, { error: describe(e, locals.i18n.t) });
		}
	},
	/** Relation::fixPmaTables on the configured pmadb: only the missing tables. */
	fixTables: async ({ locals }) => {
		const { server } = locals;
		if (!server.pmadb)
			return fail(400, { error: locals.i18n.t('No configuration storage database is set.') });
		try {
			const created = await createMissingTables(await locals.db, server.pmadb, server);
			return { created, db: server.pmadb, configured: true };
		} catch (e) {
			return fail(400, { error: describe(e, locals.i18n.t) });
		}
	},
	/** Relation::fixPmaTables on another database (the tables only, like fixall_pmadb). */
	fixCurrent: async ({ locals, request }) => {
		const parsed = dbName.safeParse((await request.formData()).get('db'));
		if (!parsed.success) return fail(400, { error: locals.i18n.t('Choose a database.') });
		const dbi = await locals.dbi;
		if (!(await dbi.databaseExists(parsed.data)))
			return fail(404, { error: locals.i18n.t('Unknown database.') });
		try {
			const created = await createMissingTables(await locals.db, parsed.data, locals.server);
			return {
				created,
				db: parsed.data,
				configured: locals.server.pmadb === parsed.data
			};
		} catch (e) {
			return fail(400, { error: describe(e, locals.i18n.t) });
		}
	}
};
