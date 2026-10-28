import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import { getSecret } from '#lib/server/auth/session.ts';
import { escapeId, quoteValue } from '#lib/server/db/escape.ts';
import {
	buildSelect,
	countRows,
	fetchRows,
	loadTableMeta,
	toBrowseRows
} from '#lib/server/table/browse.ts';
import {
	buildOrderBy,
	formatSortedCol,
	parseSort,
	parseSortedCol
} from '#lib/server/table/order-by.ts';
import {
	displayColumn,
	listForeignKeys,
	lookupDisplayValues,
	type ForeignKey
} from '#lib/server/table/relations.ts';
import { deleteRows, updateCell } from '#lib/server/table/row-actions.ts';
import { signClause, verifyClause } from '#lib/server/table/signed-clause.ts';
import {
	hiddenFromPrefs,
	loadPrefs,
	savePrefs,
	visibilityFromHidden,
	type PrefsContext
} from '#lib/server/table/ui-prefs.ts';
import { isNumericKind } from '#lib/table/column-kind.ts';
import {
	canShowAll,
	pageSize,
	paginate,
	parseRows,
	rowsOptions,
	type RowsPerPage
} from '#lib/table/pagination.ts';
import type { Sort } from '#lib/table/sort.ts';
import type { Actions, PageServerLoad } from './$types';

interface FkCell {
	href: string;
	/** Display value of the referenced row. */
	title: string | null;
}

function fkHref(fk: ForeignKey, value: string, numeric: boolean, secret: string): string {
	const literal = numeric && /^-?\d+$/.test(value) ? value : quoteValue(value);
	const clause = `${escapeId(fk.refColumn)} = ${literal}`;
	const q = new URLSearchParams({
		filter: clause,
		fsig: signClause(secret, fk.refDb, fk.refTable, clause)
	});
	return `/db/${encodeURIComponent(fk.refDb)}/table/${encodeURIComponent(fk.refTable)}/browse?${q}`;
}

export const load: PageServerLoad = async ({ params, locals, url, cookies, parent }) => {
	const { tableType } = await parent();
	const { db, table } = params;
	const dbi = await locals.dbi;
	const config = locals.config;
	const secret = getSecret(config.blowfish_secret);
	const isView = tableType === 'view';

	const meta = await loadTableMeta(dbi, db, table);
	const names = meta.columns.map((c) => c.name);
	const prefsCtx: PrefsContext = { locals, cookies, db, table };
	const prefs = await loadPrefs(prefsCtx);

	// Filter (from search / FK links); must carry a valid signature.
	let filter: { clause: string; sig: string } | null = null;
	const filterClause = url.searchParams.get('filter');
	if (filterClause) {
		const sig = url.searchParams.get('fsig');
		if (!verifyClause(secret, db, table, filterClause, sig)) error(400, 'Invalid filter signature');
		filter = { clause: filterClause, sig: sig ?? '' };
	}

	// Hints from table search: orderBy/order/perPage/cols act like sort/dir/rows and hidden columns.
	const sp = new URLSearchParams(url.searchParams);
	if (!sp.has('sort') && sp.has('orderBy')) {
		sp.set('sort', sp.get('orderBy') ?? '');
		sp.set('dir', sp.get('order') ?? 'ASC');
	}
	if (!sp.has('rows') && sp.has('perPage')) sp.set('rows', sp.get('perPage') ?? '');
	const colsHint = sp.getAll('cols').filter((c) => names.includes(c));

	// Sorting: explicit `sort` param (empty = none) wins over the remembered one.
	const remember = config.RememberSorting;
	let sort: Sort | null;
	const patch: Record<string, unknown> = {};
	if (sp.has('sort')) {
		sort = parseSort(sp.get('sort'), sp.get('dir'), names);
		if (remember) {
			const stored = parseSortedCol(prefs.sorted_col, names);
			if (stored?.column !== sort?.column || stored?.dir !== sort?.dir) {
				patch.sorted_col = sort ? formatSortedCol(table, sort) : undefined;
			}
		}
	} else {
		sort = remember ? parseSortedCol(prefs.sorted_col, names) : null;
	}

	// Rows per page.
	const storedRows: RowsPerPage =
		prefs.max_rows === 'all' || (typeof prefs.max_rows === 'number' && prefs.max_rows > 0)
			? parseRows(String(prefs.max_rows), config.MaxRows)
			: config.MaxRows;
	let rows: RowsPerPage = storedRows;
	if (sp.has('rows')) {
		rows = parseRows(sp.get('rows'), storedRows);
		if (rows !== storedRows) patch.max_rows = rows === config.MaxRows ? undefined : rows;
	}
	if (Object.keys(patch).length) await savePrefs(prefsCtx, patch);

	const hidden = colsHint.length
		? names.filter((n) => !colsHint.includes(n))
		: hiddenFromPrefs(prefs, names);
	const conn = await locals.db;
	const where = filter?.clause;
	const orderBy = sort ? buildOrderBy([sort], names) : '';

	let counted = { total: 0, approx: false };
	let queryError: string | null = null;
	let sql = buildSelect({ db, table, columns: meta.columns, where, orderBy });
	let page = paginate(0, pageSize(rows), 0);
	let seconds = 0;
	let browseRows: ReturnType<typeof toBrowseRows> = [];
	try {
		counted = await countRows(conn, db, table, {
			where,
			isView,
			maxExactCount: config.MaxExactCount
		});
		const requested = Number(url.searchParams.get('pos'));
		page = paginate(Number.isFinite(requested) ? requested : 0, pageSize(rows), counted.total);
		sql = buildSelect({
			db,
			table,
			columns: meta.columns,
			where,
			orderBy,
			offset: page.pos,
			limit: page.size
		});
		const fetched = await fetchRows(conn, sql);
		seconds = fetched.seconds;
		browseRows = toBrowseRows(secret, db, table, meta.condCols, fetched.rows);
	} catch (e) {
		queryError = e instanceof Error ? e.message : 'The query failed.';
	}

	// Foreign key links with the referenced row's display value as tooltip.
	const fkLinks: Record<string, (FkCell | null)[]> = {};
	if (browseRows.length) {
		for (const fk of await listForeignKeys(dbi, locals, db, table)) {
			const idx = names.indexOf(fk.column);
			if (idx < 0) continue;
			const numeric = isNumericKind(meta.columns[idx].kind);
			const values = [
				...new Set(
					browseRows.map((r) => r.cells[idx]).filter((v): v is string => typeof v === 'string')
				)
			];
			const display = await displayColumn(dbi, locals, fk.refDb, fk.refTable, fk.refColumn);
			const titles = display
				? await lookupDisplayValues(dbi, fk, display, values)
				: new Map<string, string>();
			fkLinks[fk.column] = browseRows.map((r) => {
				const v = r.cells[idx];
				return typeof v === 'string'
					? { href: fkHref(fk, v, numeric, secret), title: titles.get(v) ?? null }
					: null;
			});
		}
	}

	const clearFilter = new URL(url);
	clearFilter.searchParams.delete('filter');
	clearFilter.searchParams.delete('fsig');
	clearFilter.searchParams.delete('pos');

	return {
		db,
		table,
		isView,
		columns: meta.columns,
		rows: browseRows,
		hasUniqueKey: meta.hasUniqueKey,
		fkLinks,
		sort,
		rowsPerPage: rows,
		rowsOptions: rowsOptions(config.MaxRows),
		showAllAllowed: canShowAll(counted.total, config.ShowAll),
		page,
		total: counted.total,
		approx: counted.approx,
		seconds,
		sql,
		queryError,
		filter,
		clearFilterHref: clearFilter.pathname + clearFilter.search,
		hidden,
		settings: {
			limitChars: config.LimitChars,
			rowActionLinks: config.RowActionLinks,
			rowActionType: config.RowActionType,
			repeatCells: config.RepeatCells,
			order: config.Order,
			gridEditing: config.GridEditing
		}
	};
};

const rowFields = z.object({
	where: z.array(z.string().min(1)).min(1).max(500),
	sig: z.array(z.string())
});

async function guard(event: Parameters<NonNullable<Actions['delete']>>[0]) {
	const { params, locals } = event;
	const dbi = await locals.dbi;
	const type = await dbi.getTableType(params.db, params.table);
	if (type === null) error(404, 'Table not found');
	if (type === 'VIEW' || type === 'SYSTEM VIEW') {
		return { dbi, readOnly: true as const };
	}
	return { dbi, readOnly: false as const };
}

export const actions: Actions = {
	delete: async (event) => {
		const { request, params, locals } = event;
		const g = await guard(event);
		if (g.readOnly) return fail(400, { error: 'Views are read-only.' });
		const form = await request.formData();
		const parsed = rowFields.safeParse({
			where: form.getAll('where').map(String),
			sig: form.getAll('sig').map(String)
		});
		if (!parsed.success || parsed.data.where.length !== parsed.data.sig.length) {
			return fail(400, { error: 'No rows selected.' });
		}
		const secret = getSecret(locals.config.blowfish_secret);
		const { where, sig } = parsed.data;
		if (!where.every((w, i) => verifyClause(secret, params.db, params.table, w, sig[i]))) {
			return fail(400, { error: 'Invalid row signature.' });
		}
		const res = await deleteRows(await locals.db, params.db, params.table, where);
		if (!res.ok) return fail(400, { error: res.error });
		return { deleted: res.deleted, statements: res.statements };
	},

	update: async (event) => {
		const { request, params, locals } = event;
		const g = await guard(event);
		if (g.readOnly) return fail(400, { error: 'Views are read-only.' });
		const form = await request.formData();
		const parsed = z
			.object({
				where: z.string().min(1),
				sig: z.string(),
				column: z.string().min(1),
				value: z.string().optional(),
				isNull: z.string().optional()
			})
			.safeParse(Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])));
		if (!parsed.success) return fail(400, { error: 'Invalid request.' });
		const secret = getSecret(locals.config.blowfish_secret);
		const d = parsed.data;
		if (!verifyClause(secret, params.db, params.table, d.where, d.sig)) {
			return fail(400, { error: 'Invalid row signature.' });
		}
		const meta = await loadTableMeta(g.dbi, params.db, params.table);
		if (!meta.hasUniqueKey) {
			return fail(400, { error: 'This table has no unique key; use the edit page.' });
		}
		const value = d.isNull === '1' ? null : (d.value ?? '');
		const res = await updateCell(
			await locals.db,
			params.db,
			params.table,
			meta,
			d.where,
			d.column,
			value
		);
		if (!res.ok) return fail(400, { error: res.error });
		return { cell: res.cell, keyChanged: res.keyChanged, statement: res.statement };
	},

	prefs: async ({ request, params, locals, cookies }) => {
		const form = await request.formData();
		let hidden: string[];
		try {
			const v: unknown = JSON.parse(String(form.get('hidden') ?? '[]'));
			hidden = z.array(z.string()).parse(v);
		} catch {
			return fail(400, { error: 'Invalid request.' });
		}
		const dbi = await locals.dbi;
		const names = (await dbi.getColumns(params.db, params.table)).map((c) => c.field);
		await savePrefs(
			{ locals, cookies, db: params.db, table: params.table },
			{ col_visib: visibilityFromHidden(hidden, names) }
		);
		return { saved: true };
	}
};
