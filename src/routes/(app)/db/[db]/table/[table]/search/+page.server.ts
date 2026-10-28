import { redirect } from '@sveltejs/kit';
import { getSecret } from '#lib/server/auth/session.ts';
import { signClause } from '#lib/server/table/signed-clause.ts';
import { loadSearchColumns, toCriterion } from '#lib/server/table/search.ts';
import { buildWhereBody, type Criterion } from '#lib/sql/table-search.ts';
import { tabHref } from '#lib/nav/tabs.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, locals }) => {
	const dbi = await locals.dbi;
	const columns = await loadSearchColumns(
		dbi,
		params.db,
		params.table,
		locals.config.ForeignKeyMaxLimit
	);
	return {
		columns,
		maxRows: locals.config.MaxRows,
		hasGeometry: columns.some((c) => c.isGeometry)
	};
};

export const actions: Actions = {
	default: async ({ request, params, locals }) => {
		const dbi = await locals.dbi;
		const [columns, info] = await Promise.all([
			loadSearchColumns(dbi, params.db, params.table, 0),
			dbi.getServerInfo()
		]);
		const form = await request.formData();
		const criteria: Criterion[] = [];
		for (const column of columns) {
			const i = column.index;
			const criterion = toCriterion(column, {
				operator: String(form.get(`op_${i}`) ?? ''),
				values: form.getAll(`val_${i}`).map(String),
				value2: String(form.get(`val2_${i}`) ?? ''),
				geomFunc: String(form.get(`geom_${i}`) ?? '')
			});
			if (criterion) criteria.push(criterion);
		}
		// The custom clause is an explicit SQL feature (as in phpMyAdmin); like every filter it is
		// signed here and only ever executed by Browse after verification.
		const clause = buildWhereBody(criteria, String(form.get('customWhere') ?? ''), {
			isMariaDB: info.serverType === 'MariaDB'
		});

		const query = new URLSearchParams();
		if (clause !== '') {
			query.set('filter', clause);
			query.set(
				'fsig',
				signClause(getSecret(locals.config.blowfish_secret), params.db, params.table, clause)
			);
		}
		// Display hints for Browse: ignored when it does not know them.
		const shown = form
			.getAll('columnsToDisplay')
			.map(String)
			.filter((name) => columns.some((c) => c.name === name));
		if (shown.length > 0 && shown.length < columns.length) {
			for (const name of shown) query.append('cols', name);
		}
		const perPage = Number(form.get('maxRows'));
		if (Number.isInteger(perPage) && perPage > 0 && perPage !== locals.config.MaxRows) {
			query.set('perPage', String(perPage));
		}
		const orderBy = String(form.get('orderBy') ?? '');
		if (columns.some((c) => c.name === orderBy)) {
			query.set('orderBy', orderBy);
			query.set('order', form.get('order') === 'DESC' ? 'DESC' : 'ASC');
		}
		const base = tabHref('table', { db: params.db, table: params.table }, 'browse');
		const qs = query.toString();
		redirect(303, qs ? `${base}?${qs}` : base);
	}
};
