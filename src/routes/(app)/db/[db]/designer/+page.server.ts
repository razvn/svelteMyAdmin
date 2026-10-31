import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { autoLayout } from '#lib/designer/auto.ts';
import { DEFAULT_VIEW, isDesignerKey, toView } from '#lib/designer/settings.ts';
import { createRelation, deleteRelation, setDisplayField } from '#lib/server/designer/relations.ts';
import { loadDesignerSchema } from '#lib/server/designer/schema.ts';
import { loadDesignerSettings, saveDesignerSetting } from '#lib/server/designer/storage.ts';
import { hasRepo, withRepo } from '#lib/server/storage/index.ts';
import type { RelationServer } from '#lib/server/table/relation.ts';
import type { Positions } from '#lib/designer/types.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const dbi = await locals.dbi;
	const server = locals.server as RelationServer;
	const schema = await loadDesignerSchema(dbi, server, params.db);

	const pages = await withRepo(locals, 'designerPages', (r) => r.listPages(params.db));
	const requested = Number.parseInt(url.searchParams.get('page') ?? '', 10);
	const fallback = pages?.[0]?.id ?? null;
	const pageId =
		pages && pages.some((p) => p.id === requested) ? requested : requested === 0 ? null : fallback;

	let positions: Positions;
	let persisted = false;
	if (pageId !== null) {
		positions =
			(await withRepo(locals, 'designerPages', (r) => r.loadPositions(params.db, pageId))) ?? {};
		persisted = true;
	} else {
		positions = autoLayout(schema.tables, schema.relations);
	}

	let settings = DEFAULT_VIEW;
	const settingsAvailable = hasRepo(locals.server, 'designerSettings');
	if (settingsAvailable && locals.session) {
		const user = locals.session.user;
		const stored = await withRepo(locals, 'designerSettings', (r) => loadDesignerSettings(r, user));
		if (stored) settings = toView(stored);
	}

	return {
		db: params.db,
		tables: schema.tables,
		relations: schema.relations,
		storage: schema.storage,
		/** null = pages / coordinates are not configured: read-only automatic layout */
		pages,
		pageId,
		positions,
		persisted,
		settings,
		settingsAvailable
	};
};

const json = z.string().transform((s, ctx) => {
	try {
		return JSON.parse(s) as unknown;
	} catch {
		ctx.addIssue({ code: 'custom', message: 'Invalid request.' });
		return z.NEVER;
	}
});

const positionsSchema = z.record(
	z.string().max(64),
	z.object({ x: z.number().finite(), y: z.number().finite() })
);

export const actions: Actions = {
	createPage: async ({ request, locals, params }) => {
		const fd = await request.formData();
		const name = String(fd.get('name') ?? '').trim();
		if (!name || name.length > 50)
			return fail(400, { error: locals.i18n.t('Enter a page name (up to 50 characters).') });
		const dbi = await locals.dbi;
		const schema = await loadDesignerSchema(dbi, locals.server as RelationServer, params.db);
		const positions = autoLayout(schema.tables, schema.relations);
		const id = await withRepo(locals, 'designerPages', async (r) => {
			const nr = await r.createPage(params.db, name);
			await r.savePositions(params.db, nr, positions);
			return nr;
		});
		if (id === undefined)
			return fail(400, {
				error: locals.i18n.t('The configuration storage for the Designer pages is not available.')
			});
		return { pageId: id };
	},

	renamePage: async ({ request, locals, params }) => {
		const fd = await request.formData();
		const id = Number.parseInt(String(fd.get('page') ?? ''), 10);
		const name = String(fd.get('name') ?? '').trim();
		if (!Number.isInteger(id) || !name || name.length > 50) {
			return fail(400, { error: locals.i18n.t('Enter a page name (up to 50 characters).') });
		}
		const done = await withRepo(locals, 'designerPages', async (r) => {
			if (!(await r.pageExists(params.db, id))) return false;
			await r.renamePage(params.db, id, name);
			return true;
		});
		if (done === undefined)
			return fail(400, {
				error: locals.i18n.t('The configuration storage for the Designer pages is not available.')
			});
		if (!done) return fail(404, { error: locals.i18n.t('Unknown page.') });
		return { pageId: id };
	},

	deletePage: async ({ request, locals, params }) => {
		const id = Number.parseInt(String((await request.formData()).get('page') ?? ''), 10);
		if (!Number.isInteger(id)) return fail(400, { error: locals.i18n.t('Invalid page.') });
		const done = await withRepo(locals, 'designerPages', async (r) => {
			if (!(await r.pageExists(params.db, id))) return false;
			await r.deletePage(params.db, id);
			return true;
		});
		if (done === undefined)
			return fail(400, {
				error: locals.i18n.t('The configuration storage for the Designer pages is not available.')
			});
		if (!done) return fail(404, { error: locals.i18n.t('Unknown page.') });
		return { deleted: id };
	},

	savePositions: async ({ request, locals, params }) => {
		const fd = await request.formData();
		const id = Number.parseInt(String(fd.get('page') ?? ''), 10);
		const parsed = json.pipe(positionsSchema).safeParse(String(fd.get('positions') ?? ''));
		if (!Number.isInteger(id) || !parsed.success)
			return fail(400, { error: locals.i18n.t('Invalid request.') });
		const dbi = await locals.dbi;
		const known = new Set((await dbi.listTables(params.db)).map((t) => t.name));
		const positions: Positions = {};
		for (const [name, p] of Object.entries(parsed.data)) if (known.has(name)) positions[name] = p;
		const done = await withRepo(locals, 'designerPages', async (r) => {
			if (!(await r.pageExists(params.db, id))) return false;
			await r.savePositions(params.db, id, positions);
			return true;
		});
		if (done === undefined)
			return fail(400, {
				error: locals.i18n.t('The configuration storage for the Designer pages is not available.')
			});
		if (!done) return fail(404, { error: locals.i18n.t('Unknown page.') });
		return { saved: Object.keys(positions).length };
	},

	saveSetting: async ({ request, locals }) => {
		const fd = await request.formData();
		const key = String(fd.get('key') ?? '');
		const value = String(fd.get('value') ?? '').slice(0, 32);
		if (!isDesignerKey(key) || !locals.session)
			return fail(400, { error: locals.i18n.t('Invalid setting.') });
		const user = locals.session.user;
		const done = await withRepo(locals, 'designerSettings', async (r) => {
			await saveDesignerSetting(r, user, key, value);
			return true;
		});
		// no storage: the setting just lives for the session
		return { saved: done === true };
	},

	createRelation: async ({ request, locals, params }) => {
		const raw = json.safeParse(String((await request.formData()).get('payload') ?? ''));
		if (!raw.success) return fail(400, { error: locals.i18n.t('Invalid request.') });
		const res = await createRelation(
			await locals.dbi,
			locals.server as RelationServer,
			params.db,
			raw.data
		);
		if (!res.ok) return fail(400, { error: locals.i18n.t(res.error), sql: res.sql });
		return { done: res.sql };
	},

	deleteRelation: async ({ request, locals, params }) => {
		const raw = json.safeParse(String((await request.formData()).get('payload') ?? ''));
		if (!raw.success) return fail(400, { error: locals.i18n.t('Invalid request.') });
		const res = await deleteRelation(
			await locals.dbi,
			locals.server as RelationServer,
			params.db,
			raw.data
		);
		if (!res.ok) return fail(400, { error: locals.i18n.t(res.error), sql: res.sql });
		return { done: res.sql };
	},

	setDisplay: async ({ request, locals, params }) => {
		const raw = json.safeParse(String((await request.formData()).get('payload') ?? ''));
		if (!raw.success) return fail(400, { error: locals.i18n.t('Invalid request.') });
		const res = await setDisplayField(
			await locals.dbi,
			locals.server as RelationServer,
			params.db,
			raw.data
		);
		if (!res.ok) return fail(400, { error: locals.i18n.t(res.error), sql: res.sql });
		return { done: true };
	}
};
