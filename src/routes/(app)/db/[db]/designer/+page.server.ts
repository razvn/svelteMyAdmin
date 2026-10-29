import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { autoLayout } from '#lib/designer/auto.ts';
import { DEFAULT_VIEW, isDesignerKey, toView } from '#lib/designer/settings.ts';
import { createRelation, deleteRelation, setDisplayField } from '#lib/server/designer/relations.ts';
import { loadDesignerSchema } from '#lib/server/designer/schema.ts';
import {
	createPage,
	deletePage,
	listPages,
	loadPositions,
	loadSettings,
	pageExists,
	renamePage,
	savePositions,
	saveSetting,
	settingsTable,
	withDesignerTables
} from '#lib/server/designer/storage.ts';
import { withStorageTable } from '#lib/server/pmadb/index.ts';
import type { RelationServer } from '#lib/server/table/relation.ts';
import type { Positions } from '#lib/designer/types.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const dbi = await locals.dbi;
	const server = locals.server as RelationServer;
	const schema = await loadDesignerSchema(dbi, server, params.db);

	const pages = await withDesignerTables(locals, (c, t) => listPages(c, t, params.db));
	const requested = Number.parseInt(url.searchParams.get('page') ?? '', 10);
	const fallback = pages?.[0]?.id ?? null;
	const pageId =
		pages && pages.some((p) => p.id === requested) ? requested : requested === 0 ? null : fallback;

	let positions: Positions;
	let persisted = false;
	if (pageId !== null) {
		positions =
			(await withDesignerTables(locals, (c, t) => loadPositions(c, t, params.db, pageId))) ?? {};
		persisted = true;
	} else {
		positions = autoLayout(schema.tables, schema.relations);
	}

	let settings = DEFAULT_VIEW;
	const settingsQ = settingsTable(locals.server);
	if (settingsQ && locals.session) {
		const user = locals.session.user;
		const stored = await withStorageTable(locals, 'designer_settings', (c, q) =>
			loadSettings(c, q, user)
		);
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
		settingsAvailable: settingsQ !== null
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
		const id = await withDesignerTables(locals, async (c, t) => {
			const nr = await createPage(c, t, params.db, name);
			await savePositions(c, t, params.db, nr, positions);
			return nr;
		});
		if (id === undefined) return fail(400, {
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
		const done = await withDesignerTables(locals, async (c, t) => {
			if (!(await pageExists(c, t, params.db, id))) return false;
			await renamePage(c, t, params.db, id, name);
			return true;
		});
		if (done === undefined) return fail(400, {
			error: locals.i18n.t('The configuration storage for the Designer pages is not available.')
		});
		if (!done) return fail(404, { error: locals.i18n.t('Unknown page.') });
		return { pageId: id };
	},

	deletePage: async ({ request, locals, params }) => {
		const id = Number.parseInt(String((await request.formData()).get('page') ?? ''), 10);
		if (!Number.isInteger(id)) return fail(400, { error: locals.i18n.t('Invalid page.') });
		const done = await withDesignerTables(locals, async (c, t) => {
			if (!(await pageExists(c, t, params.db, id))) return false;
			await deletePage(c, t, params.db, id);
			return true;
		});
		if (done === undefined) return fail(400, {
			error: locals.i18n.t('The configuration storage for the Designer pages is not available.')
		});
		if (!done) return fail(404, { error: locals.i18n.t('Unknown page.') });
		return { deleted: id };
	},

	savePositions: async ({ request, locals, params }) => {
		const fd = await request.formData();
		const id = Number.parseInt(String(fd.get('page') ?? ''), 10);
		const parsed = json.pipe(positionsSchema).safeParse(String(fd.get('positions') ?? ''));
		if (!Number.isInteger(id) || !parsed.success) return fail(400, { error: locals.i18n.t('Invalid request.') });
		const dbi = await locals.dbi;
		const known = new Set((await dbi.listTables(params.db)).map((t) => t.name));
		const positions: Positions = {};
		for (const [name, p] of Object.entries(parsed.data)) if (known.has(name)) positions[name] = p;
		const done = await withDesignerTables(locals, async (c, t) => {
			if (!(await pageExists(c, t, params.db, id))) return false;
			await savePositions(c, t, params.db, id, positions);
			return true;
		});
		if (done === undefined) return fail(400, {
			error: locals.i18n.t('The configuration storage for the Designer pages is not available.')
		});
		if (!done) return fail(404, { error: locals.i18n.t('Unknown page.') });
		return { saved: Object.keys(positions).length };
	},

	saveSetting: async ({ request, locals }) => {
		const fd = await request.formData();
		const key = String(fd.get('key') ?? '');
		const value = String(fd.get('value') ?? '').slice(0, 32);
		if (!isDesignerKey(key) || !locals.session) return fail(400, { error: locals.i18n.t('Invalid setting.') });
		const user = locals.session.user;
		const done = await withStorageTable(locals, 'designer_settings', async (c, q) => {
			await saveSetting(c, q, user, key, value);
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
