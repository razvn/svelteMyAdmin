/**
 * Parse and validate the export form (phpMyAdmin's /export POST) into an ExportRequest.
 * Field names follow phpMyAdmin: `what`, `<format>_<option>`, `<format>_structure_or_data`,
 * `db_select[]`, `table_structure[]`, `table_data[]`, `where[]`+`sig[]`, `allrows`, `limit_to`,
 * `limit_from`, `sql_query`, `output_format`, `filename_template`, `charset`, `compression`.
 */
import { z } from 'zod';
import { splitStatements } from '#lib/server/db/splitter.ts';
import { verifyClause } from '#lib/server/table/signed-clause.ts';
import { COMPRESSIONS } from './defaults.ts';
import { getExportPlugin, IGNORES_STRUCTURE_OR_DATA } from './registry.ts';
import { normalizeCharset } from './sink.ts';
import type { Compression } from './filename.ts';
import type { ExportRequest, ExportTableSelection } from './run.ts';
import type { ExportOptionValues, ExportPlugin, ExportScope, StructureOrData } from './types.ts';

export class ExportInputError extends Error {}

export interface ParsedExport {
	request: ExportRequest;
	output: 'download' | 'view';
	filenameTemplate: string;
	compression: Compression;
	charset: string;
	/** True when `remember_template` was ticked (phpMyAdmin stores the file name template). */
	rememberTemplate: boolean;
}

export interface ParseContext {
	/** The page level: where the export was opened. */
	level: 'server' | 'database' | 'table';
	db?: string;
	table?: string;
	secret: string;
}

const scalar = z.object({
	what: z.string().min(1),
	output_format: z.enum(['sendit', 'astext']).default('sendit'),
	filename_template: z.string().max(255).default(''),
	compression: z.enum(COMPRESSIONS).default('none'),
	charset: z.string().default('utf-8'),
	allrows: z.enum(['0', '1']).default('1'),
	limit_to: z.coerce.number().int().min(0).default(0),
	limit_from: z.coerce.number().int().min(0).default(0)
});

const READ_ONLY = /^\s*(?:\(\s*)*(select|with|show|describe|desc|explain|table|values)\b/i;

/** The query of a result export: one read-only statement. */
export function checkExportQuery(sql: string): string {
	const statements = splitStatements(sql).filter((s) => s.sql.trim() !== '');
	if (statements.length !== 1) throw new ExportInputError('Exactly one SQL statement is required.');
	const only = statements[0].sql.trim();
	if (!READ_ONLY.test(only))
		throw new ExportInputError('Only queries returning rows can be exported.');
	return only;
}

function bool(form: FormData, key: string): boolean {
	const v = form.get(key);
	return v !== null && v !== '' && v !== 'false' && v !== '0' && v !== 'off';
}

export function pluginOptionValues(plugin: ExportPlugin, form: FormData): ExportOptionValues {
	const values: ExportOptionValues = {};
	for (const o of plugin.options) {
		const key = `${plugin.id}_${o.name}`;
		if (o.kind === 'bool') {
			values[o.name] = bool(form, key);
			continue;
		}
		const raw = form.get(key);
		const text = typeof raw === 'string' ? raw : '';
		if (o.kind === 'number') {
			const n = Number(text);
			values[o.name] = text !== '' && Number.isFinite(n) ? n : o.default;
		} else if (o.kind === 'select' || o.kind === 'radio') {
			values[o.name] = o.choices.some((c) => c.value === text) ? text : o.default;
		} else {
			values[o.name] = text.slice(0, 5000);
		}
	}
	return values;
}

export function parseExportForm(form: FormData, ctx: ParseContext): ParsedExport {
	const s = scalar.safeParse(
		Object.fromEntries([...form.entries()].filter(([, v]) => typeof v === 'string'))
	);
	if (!s.success) throw new ExportInputError('Invalid export parameters.');
	const f = s.data;

	const sqlQuery = String(form.get('sql_query') ?? '').trim();
	let scope: ExportScope = ctx.level;
	if (sqlQuery && ctx.level !== 'table') scope = 'raw';

	const plugin = getExportPlugin(f.what);
	if (!plugin || !plugin.scopes.includes(scope))
		throw new ExportInputError('Unknown export format.');

	const sodRaw = String(form.get(`${plugin.id}_structure_or_data`) ?? '');
	let structureOrData: StructureOrData =
		(['structure', 'data', 'structure_and_data'] as const).find((v) => v === sodRaw) ??
		(plugin.supports.structure && plugin.supports.data
			? 'structure_and_data'
			: plugin.supports.structure
				? 'structure'
				: 'data');
	if (!plugin.supports.structure) structureOrData = 'data';
	if (!plugin.supports.data) structureOrData = 'structure';
	if (scope === 'raw') structureOrData = 'data';
	if (IGNORES_STRUCTURE_OR_DATA.has(plugin.id)) structureOrData = 'structure_and_data';

	const request: ExportRequest = {
		scope,
		plugin,
		options: pluginOptionValues(plugin, form),
		structureOrData,
		databases: []
	};

	if (scope === 'server') {
		const dbs = form.getAll('db_select[]').map(String).filter(Boolean);
		if (!dbs.length) throw new ExportInputError('Select at least one database.');
		request.databases = [...new Set(dbs)];
	} else {
		if (!ctx.db) throw new ExportInputError('Missing database.');
		request.databases = [ctx.db];
	}

	if (scope === 'database') {
		const structure = new Set(form.getAll('table_structure[]').map(String));
		const data = new Set(form.getAll('table_data[]').map(String));
		const names = [...new Set([...structure, ...data])];
		if (!names.length) throw new ExportInputError('Select at least one table.');
		request.tables = names.map((name): ExportTableSelection => ({
			name,
			structure: structure.has(name),
			data: data.has(name)
		}));
	}

	if (scope === 'table') {
		if (!ctx.table) throw new ExportInputError('Missing table.');
		request.table = ctx.table;
		const wheres = form.getAll('where[]').map(String);
		const sigs = form.getAll('sig[]').map(String);
		if (wheres.length !== sigs.length) throw new ExportInputError('Invalid row selection.');
		for (let i = 0; i < wheres.length; i++) {
			if (!verifyClause(ctx.secret, ctx.db!, ctx.table, wheres[i], sigs[i])) {
				throw new ExportInputError('Invalid row selection.');
			}
		}
		if (wheres.length) request.where = wheres;
		if (sqlQuery && !wheres.length) request.sqlQuery = checkExportQuery(sqlQuery);
		if (!wheres.length) {
			request.allRows = f.allrows === '1';
			request.limitFrom = f.limit_from;
			request.limitTo = f.limit_to;
			if (!request.allRows && f.limit_to < 1) throw new ExportInputError('Invalid row range.');
		}
	}

	if (scope === 'raw') {
		if (!sqlQuery) throw new ExportInputError('Missing query.');
		request.sqlQuery = checkExportQuery(sqlQuery);
	}

	const output = f.output_format === 'astext' ? 'view' : 'download';
	if (output === 'view' && plugin.binary) {
		throw new ExportInputError('This format cannot be displayed as text.');
	}
	return {
		request,
		output,
		filenameTemplate: f.filename_template,
		compression: f.compression,
		charset: normalizeCharset(f.charset),
		rememberTemplate: bool(form, 'remember_template')
	};
}
