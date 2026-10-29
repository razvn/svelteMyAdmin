/**
 * GIS visualization data (Controllers/Table/GisVisualizationController.php + Gis/GisVisualization.php):
 * runs a SELECT, finds its spatial columns and returns the rows with ST_AsText / ST_SRID.
 */
import type { FieldPacket } from 'mysql2/promise';
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import { escapeId, escapeQualified } from '#lib/server/db/escape.ts';
import { splitStatements } from '#lib/server/db/splitter.ts';
import { describeField } from '#lib/server/sql/execute.ts';
import { classifyStatement } from '#lib/sql/classify.ts';

export interface GisRow {
	/** Label column value ('' when none). */
	label: string;
	wkt: string;
	srid: number;
	/** All non-spatial column values, as text. */
	values: Record<string, string | null>;
}

export interface GisData {
	spatialColumns: string[];
	columns: string[];
	geometryColumn: string;
	labelColumn: string;
	rows: GisRow[];
	total: number;
	limit: number;
	offset: number;
}

export class GisError extends Error {}

export const DEFAULT_LIMIT = 1000;
export const MAX_LIMIT = 10000;

/** The query to visualize: a validated single SELECT, or the whole table. */
export function baseQuery(db: string, table: string, sql: string | null): string {
	if (sql === null || sql.trim() === '') return `SELECT * FROM ${escapeQualified(db, table)}`;
	const statements = splitStatements(sql);
	if (statements.length !== 1 || classifyStatement(statements[0].sql) !== 'select') {
		throw new GisError('Only a single SELECT statement can be visualized.');
	}
	return statements[0].sql.trim().replace(/;+\s*$/, '');
}

const text = (v: unknown): string | null => {
	if (v === null || v === undefined) return null;
	if (Buffer.isBuffer(v)) return '[BLOB]';
	if (v instanceof Date)
		return v
			.toISOString()
			.replace('T', ' ')
			.replace(/\.000Z$/, '');
	return String(v);
};

export async function loadGisData(
	dbi: DatabaseInterface,
	db: string,
	table: string,
	opts: {
		sql: string | null;
		geometryColumn?: string;
		labelColumn?: string;
		limit?: number;
		offset?: number;
	}
): Promise<GisData> {
	const base = baseQuery(db, table, opts.sql);
	const limit = Math.min(
		Math.max(Math.trunc(opts.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1),
		MAX_LIMIT
	);
	const offset = Math.max(Math.trunc(opts.offset ?? 0) || 0, 0);
	const conn = dbi.conn;
	await conn.query(`USE ${escapeId(db)}`);

	let fields: FieldPacket[];
	try {
		[, fields] = await conn.query(`SELECT * FROM (${base}) AS t LIMIT 0`);
	} catch (e) {
		throw new GisError(
			(e as { sqlMessage?: string }).sqlMessage ?? 'The query could not be executed.'
		);
	}
	const columns = fields.map((f) => f.name);
	const spatialColumns = fields
		.filter((f) => describeField(f).kind === 'geometry')
		.map((f) => f.name);
	const geometryColumn = spatialColumns.includes(opts.geometryColumn ?? '')
		? (opts.geometryColumn as string)
		: (spatialColumns[0] ?? '');
	const labelColumn = columns.includes(opts.labelColumn ?? '') ? (opts.labelColumn as string) : '';
	const empty = { spatialColumns, columns, geometryColumn, labelColumn, limit, offset };
	if (!geometryColumn) return { ...empty, rows: [], total: 0 };

	const info = await dbi.getServerInfo();
	// MySQL 8 prints geographic (SRID 4326) points as "lat lon"; ask for x/y order.
	const asText =
		info.serverType !== 'MariaDB' && info.versionInt >= 80000
			? (c: string) => `ST_AsText(t.${escapeId(c)}, 'axis-order=long-lat')`
			: (c: string) => `ST_AsText(t.${escapeId(c)})`;
	const plain = columns.filter((c) => !spatialColumns.includes(c));
	const select = [
		`${asText(geometryColumn)} AS __wkt`,
		`ST_SRID(t.${escapeId(geometryColumn)}) AS __srid`,
		...plain.map((c, i) => `t.${escapeId(c)} AS ${escapeId(`c${i}`)}`),
		...spatialColumns.map((c, i) => `${asText(c)} AS ${escapeId(`g${i}`)}`)
	];
	const [rows] = await conn.query(
		`SELECT ${select.join(', ')} FROM (${base}) AS t WHERE t.${escapeId(geometryColumn)} IS NOT NULL LIMIT ${limit} OFFSET ${offset}`
	);
	const [totalRows] = await conn.query(
		`SELECT COUNT(*) AS n FROM (${base}) AS t WHERE t.${escapeId(geometryColumn)} IS NOT NULL`
	);
	const out: GisRow[] = (rows as Record<string, unknown>[]).map((r) => {
		const values: Record<string, string | null> = {};
		plain.forEach((c, i) => (values[c] = text(r[`c${i}`])));
		spatialColumns.forEach((c, i) => (values[c] = text(r[`g${i}`])));
		return {
			label: labelColumn ? (values[labelColumn] ?? '') : '',
			wkt: String(r.__wkt ?? ''),
			srid: Number(r.__srid ?? 0),
			values
		};
	});
	return { ...empty, rows: out, total: Number((totalRows as { n: unknown }[])[0].n) };
}
