import { fail } from '@sveltejs/kit';
import { z } from 'zod';
import { columnSchema, normalizeColumns } from '#lib/server/database/create-table.ts';
import { getColumnEditorContext } from '#lib/server/database/create-table.ts';
import {
	addCentral,
	addTableColumns,
	countCentral,
	deleteCentral,
	listCentral,
	updateCentral
} from '#lib/server/pmadb/central-columns.ts';
import { withStorageTable } from '#lib/server/pmadb/index.ts';
import { fromColumnDef, toColumnDef, type CentralColumn } from '#lib/sql/central-columns.ts';
import type { ColumnDef } from '#lib/sql/column-definition.ts';
import type { Actions, PageServerLoad } from './$types';
import { N_ } from '#lib/i18n/translator.ts';

const UNAVAILABLE = N_(
	'The configuration storage is not ready for the central list of columns feature.'
);

export const load: PageServerLoad = async ({ locals, params, url }) => {
	const dbi = await locals.dbi;
	const size = locals.config.MaxRows;
	const filter = (url.searchParams.get('q') ?? '').trim().slice(0, 64);
	const pos = Math.max(0, Number.parseInt(url.searchParams.get('pos') ?? '0', 10) || 0);
	const from = url.searchParams.get('from') ?? '';

	const tables = (await dbi.listTables(params.db))
		.filter((tbl) => tbl.type === 'BASE TABLE')
		.map((tbl) => tbl.name);
	const listed = await withStorageTable(locals, 'central_columns', async (conn, q) => {
		const [columns, total, all] = await Promise.all([
			listCentral(conn, q, params.db, { pos, num: size, filter }),
			countCentral(conn, q, params.db, filter),
			listCentral(conn, q, params.db)
		]);
		return { columns, total, names: new Set(all.map((c) => c.name)) };
	});
	const editor = await getColumnEditorContext(dbi);
	if (!listed) {
		return { available: false as const, db: params.db, ...editor };
	}
	let candidates: { name: string; type: string }[] = [];
	if (from && tables.includes(from)) {
		candidates = (await dbi.getColumns(params.db, from))
			.filter((c) => !listed.names.has(c.field))
			.map((c) => ({ name: c.field, type: c.type }));
	}
	return {
		available: true as const,
		db: params.db,
		...editor,
		columns: listed.columns,
		editable: listed.columns.map((c) => toColumnDef(c)),
		total: listed.total,
		pos,
		size,
		filter,
		tables,
		from,
		candidates
	};
};

const definition = z.object({ original: z.string().max(64).default(''), column: columnSchema });

async function parseDefinition(
	locals: App.Locals,
	raw: string
): Promise<{ original: string; column: CentralColumn } | string> {
	let parsed: z.infer<typeof definition>;
	try {
		parsed = definition.parse(JSON.parse(raw));
	} catch {
		return locals.i18n.t('Invalid column definition.');
	}
	if (!parsed.column.name.trim()) return locals.i18n.t('The column name is empty!');
	const { caps } = await getColumnEditorContext(await locals.dbi);
	const norm = normalizeColumns([parsed.column], caps, locals.i18n);
	if (!norm.ok) return norm.error;
	return { original: parsed.original, column: fromColumnDef(norm.columns[0] as ColumnDef) };
}

const names = (fd: FormData) =>
	fd
		.getAll('column')
		.map(String)
		.filter((n) => n !== '');

export const actions: Actions = {
	/** Add a new column (or, with `original`, save an edited one). */
	save: async ({ request, locals, params }) => {
		const fd = await request.formData();
		const def = await parseDefinition(locals, String(fd.get('definition') ?? ''));
		if (typeof def === 'string') return fail(400, { error: def });
		const done = await withStorageTable(locals, 'central_columns', async (conn, q) => {
			try {
				if (def.original) {
					await updateCentral(conn, q, params.db, def.original, def.column);
					return {
						message: locals.i18n.t('Column {name} has been updated.', { name: def.column.name })
					};
				}
				const res = await addCentral(conn, q, params.db, [def.column]);
				if (res.existing.length) {
					return {
						error: locals.i18n.t(
							'Could not add {columns} as it already exists in the central list!',
							{ columns: res.existing.join(', ') }
						)
					};
				}
				return {
					message: locals.i18n.t('Column {name} has been added to the central list.', {
						name: def.column.name
					})
				};
			} catch (e) {
				return { error: (e as { sqlMessage?: string }).sqlMessage ?? locals.i18n.t('Could not save the column.') };
			}
		});
		if (!done) return fail(400, { error: locals.i18n.t(UNAVAILABLE) });
		if ('error' in done) return fail(400, { error: done.error });
		return done;
	},

	delete: async ({ request, locals, params }) => {
		const list = names(await request.formData());
		if (list.length === 0) return fail(400, { error: locals.i18n.t('No columns selected.') });
		const missing = await withStorageTable(locals, 'central_columns', (conn, q) =>
			deleteCentral(conn, q, params.db, list)
		);
		if (!missing) return fail(400, { error: locals.i18n.t(UNAVAILABLE) });
		return {
			message:
				locals.i18n.tn(
					'{n} column removed from the central list.',
					'{n} columns removed from the central list.',
					list.length - missing.length
				) +
				(missing.length
					? ' ' + locals.i18n.t('Not in the list: {columns}.', { columns: missing.join(', ') })
					: '')
		};
	},

	/** Add columns of a table to the central list. */
	addFromTable: async ({ request, locals, params }) => {
		const fd = await request.formData();
		const table = String(fd.get('table') ?? '');
		const list = names(fd);
		if (!table || list.length === 0) return fail(400, { error: locals.i18n.t('No columns selected.') });
		const dbi = await locals.dbi;
		const res = await withStorageTable(locals, 'central_columns', (conn, q) =>
			addTableColumns(conn, q, dbi, params.db, table, list)
		);
		if (!res) return fail(400, { error: locals.i18n.t(UNAVAILABLE) });
		return {
			message:
				locals.i18n.tn(
					'{n} column added to the central list.',
					'{n} columns added to the central list.',
					res.added.length
				) +
				(res.existing.length
					? ' ' +
						locals.i18n.t('Already in the list: {columns}.', { columns: res.existing.join(', ') })
					: '')
		};
	}
};
