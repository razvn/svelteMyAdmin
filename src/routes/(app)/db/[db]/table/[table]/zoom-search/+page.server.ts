import type { RowDataPacket } from 'mysql2/promise';
import { buildAxis, axisKindForType, toAxisData, type Axis } from '#lib/chart/scatter.ts';
import { tabHref } from '#lib/nav/tabs.ts';
import { getSecret } from '#lib/server/auth/session.ts';
import { escapeQualified } from '#lib/server/db/escape.ts';
import { loadTableMeta } from '#lib/server/table/browse.ts';
import { loadSearchColumns, toCriterion } from '#lib/server/table/search.ts';
import { signClause } from '#lib/server/table/signed-clause.ts';
import { uniqueCondition, type RowValue } from '#lib/server/table/unique-condition.ts';
import {
	baseColumnType,
	buildWhereBody,
	getTypeClass,
	type Criterion
} from '#lib/sql/table-search.ts';
import type { PageServerLoad } from './$types';

const SLOTS = 4;

/** A cell as text for the tooltip and side sheet; null stays null. */
function cellText(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (value instanceof Uint8Array) {
		const hex = Buffer.from(value).subarray(0, 32).toString('hex');
		return `0x${hex}${value.length > 32 ? '…' : ''}`;
	}
	if (typeof value === 'object') return JSON.stringify(value);
	return String(value);
}

export interface ZoomPlot {
	columnNames: string[];
	x: { name: string; axis: Axis };
	y: { name: string; axis: Axis };
	labelColumn: string;
	points: {
		id: number;
		x: number;
		y: number;
		values: (string | null)[];
		editHref: string | null;
	}[];
	total: number;
	skipped: number;
	limit: number;
	where: string;
}

export const load: PageServerLoad = async ({ params, locals, url }) => {
	const dbi = await locals.dbi;
	const columns = await loadSearchColumns(
		dbi,
		params.db,
		params.table,
		locals.config.ForeignKeyMaxLimit
	);
	const q = url.searchParams;
	const submitted = q.has('go');

	const limitParam = Number(q.get('limit'));
	const limit =
		Number.isInteger(limitParam) && limitParam > 0
			? Math.min(limitParam, 100000)
			: locals.config.maxRowPlotLimit;
	const defaultLabel =
		columns.find((c) => getTypeClass(baseColumnType(c.type)) === 'CHAR' && !c.enumValues)?.name ??
		'';
	const label = q.has('label') ? (q.get('label') ?? '') : defaultLabel;

	// Selected columns per slot (validated against the table).
	const slotColumns = Array.from({ length: SLOTS }, (_, k) => {
		const name = q.get(`col_${k}`) ?? '';
		return columns.find((c) => c.name === name) ?? null;
	});
	const form = { cols: slotColumns.map((c) => c?.name ?? ''), limit, label };

	let plot: ZoomPlot | null = null;
	let error: string | null = null;
	if (submitted) {
		const [cx, cy] = slotColumns;
		if (!cx || !cy || cx.name === cy.name) {
			error = locals.i18n.t('Select two different columns for the X and Y axes.');
		} else {
			const info = await dbi.getServerInfo();
			const criteria: Criterion[] = [];
			slotColumns.forEach((column, k) => {
				if (!column) return;
				const c = toCriterion(column, {
					operator: q.get(`op_${k}`) ?? '',
					values: q.getAll(`val_${k}`),
					value2: q.get(`val2_${k}`) ?? '',
					geomFunc: q.get(`geom_${k}`) ?? ''
				});
				if (c) criteria.push(c);
			});
			const where = buildWhereBody(criteria, '', { isMariaDB: info.serverType === 'MariaDB' });
			const [rows] = await dbi.conn.query<RowDataPacket[]>(
				`SELECT * FROM ${escapeQualified(params.db, params.table)}` +
					(where ? ` WHERE ${where}` : '') +
					` LIMIT ${limit}`
			);
			const meta = await loadTableMeta(dbi, params.db, params.table);
			const names = meta.columns.map((c) => c.name);
			const secret = getSecret(locals.config.blowfish_secret);
			const base = tabHref('table', { db: params.db, table: params.table }, 'insert');

			const text = rows.map((r) => names.map((n) => cellText(r[n])));
			const xi = names.indexOf(cx.name);
			const yi = names.indexOf(cy.name);
			const xData = toAxisData(
				axisKindForType(cx.type),
				text.map((r) => r[xi])
			);
			const yData = toAxisData(
				axisKindForType(cy.type),
				text.map((r) => r[yi])
			);
			const points: ZoomPlot['points'] = [];
			let skipped = 0;
			rows.forEach((row, i) => {
				const x = xData.values[i];
				const y = yData.values[i];
				if (x === null || y === null) {
					skipped++;
					return;
				}
				const cond = uniqueCondition(
					params.table,
					meta.condCols,
					names.map((n) => row[n] as RowValue)
				).clause;
				const editHref = cond
					? `${base}?${new URLSearchParams({ where: cond, sig: signClause(secret, params.db, params.table, cond) })}`
					: null;
				points.push({ id: points.length, x, y, values: text[i], editHref });
			});
			// Axes are built from the plotted values only.
			const keep = (d: typeof xData) => ({
				...d,
				values: d.values.filter((v): v is number => v !== null)
			});
			plot = {
				columnNames: names,
				x: { name: cx.name, axis: buildAxis(keep(xData)) },
				y: { name: cy.name, axis: buildAxis(keep(yData)) },
				labelColumn: label,
				points,
				total: rows.length,
				skipped,
				limit,
				where
			};
		}
	}
	return { columns, form, submitted, plot, error };
};
