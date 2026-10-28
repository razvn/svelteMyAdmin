/**
 * SvelteKit glue of the export pages: page load data, the POST that runs an export (download or
 * view as text) and the template CRUD endpoint. The three levels (server, database, table) share it.
 */
import { error, json, type RequestEvent } from '@sveltejs/kit';
import { z } from 'zod';
import { getAppInfo } from '#lib/server/app-info.ts';
import { getSecret } from '#lib/server/auth/session.ts';
import { readSignedClauses } from '#lib/server/table/signed-clause.ts';
import { buildDefaults } from './defaults.ts';
import { exportFilename } from './filename.ts';
import { exportPlugins, IGNORES_STRUCTURE_OR_DATA, pluginsForScope } from './registry.ts';
import { ExportInputError, checkExportQuery, parseExportForm } from './request.ts';
import { exportToStream, exportToText, type ExportEnv } from './run.ts';
import {
	createTemplate,
	deleteTemplate,
	listTemplates,
	loadTemplate,
	updateTemplate
} from './templates.ts';
import { EXPORT_CHARSETS } from './sink.ts';
import type { ExportScope } from './types.ts';

export type ExportLevel = 'server' | 'database' | 'table';

/** Text view cap (characters). */
export const VIEW_LIMIT = 2_000_000;

/** Databases that are preselected nowhere by default (phpMyAdmin skips them in the server export list). */
const SYSTEM_DBS = new Set(['information_schema', 'performance_schema', 'mysql', 'sys']);

const scopeOf = (level: ExportLevel): ExportScope => level;

export async function loadExportPage(event: RequestEvent, level: ExportLevel) {
	const { locals, url, params } = event;
	const dbi = await locals.dbi;
	const secret = getSecret(locals.config.blowfish_secret);
	const db = params.db ?? '';
	const table = params.table ?? '';

	let sqlQuery = '';
	const rawQuery = url.searchParams.get('sql_query');
	if (rawQuery) {
		try {
			sqlQuery = checkExportQuery(rawQuery);
		} catch {
			error(400, 'Only a single query returning rows can be exported.');
		}
	}

	let selectedRows: { where: string; sig: string }[] = [];
	if (level === 'table') {
		const clauses = readSignedClauses(url, secret, db, table);
		if (clauses === null) error(400, 'Invalid row selection.');
		const sigs = url.searchParams.getAll('sig');
		selectedRows = clauses.map((where, i) => ({ where, sig: sigs[i] }));
	}

	const scope: ExportScope = sqlQuery && level !== 'table' ? 'raw' : scopeOf(level);
	const plugins = pluginsForScope(scope).map((p) => ({
		id: p.id,
		label: p.label,
		extension: p.extension,
		binary: !!p.binary,
		fixedStructure: IGNORES_STRUCTURE_OR_DATA.has(p.id),
		supports: p.supports,
		options: p.options
	}));

	let databases: { name: string; checked: boolean }[] = [];
	let tables: { name: string; kind: 'table' | 'view'; rows: number | null }[] = [];
	if (level === 'server') {
		databases = (await dbi.listDatabases()).map((name) => ({
			name,
			checked: !SYSTEM_DBS.has(name.toLowerCase())
		}));
	} else {
		if (!(await dbi.databaseExists(db))) error(404, 'Database not found');
		if (level === 'database') {
			tables = (await dbi.listTables(db)).map((t) => ({
				name: t.name,
				kind: t.type.includes('VIEW') ? 'view' : 'table',
				rows: t.rows
			}));
		} else if ((await dbi.getTableType(db, table)) === null) {
			error(404, 'Table not found');
		}
	}

	return {
		level,
		scope,
		db,
		table,
		action: event.url.pathname,
		plugins,
		defaults: buildDefaults(locals.config.Export, exportPlugins, level),
		charsets: Object.keys(EXPORT_CHARSETS),
		databases,
		tables,
		sqlQuery,
		selectedRows,
		templates: await listTemplates(locals, level)
	};
}

export async function handleExportPost(event: RequestEvent, level: ExportLevel): Promise<Response> {
	const { locals, params, request } = event;
	const form = await request.formData();
	const secret = getSecret(locals.config.blowfish_secret);

	let parsed;
	try {
		parsed = parseExportForm(form, { level, db: params.db, table: params.table, secret });
	} catch (e) {
		if (e instanceof ExportInputError) error(400, e.message);
		throw e;
	}
	const req = parsed.request;
	const dbi = await locals.dbi;

	if (level === 'server') {
		const known = new Set(await dbi.listDatabases());
		if (!req.databases.every((d) => known.has(d))) error(400, 'Unknown database.');
	} else if (!(await dbi.databaseExists(req.databases[0]))) {
		error(404, 'Database not found');
	}

	const info = await dbi.getServerInfo();
	const server = locals.server;
	const env: ExportEnv = {
		conn: await locals.db,
		server: {
			version: info.version,
			isMariaDb: info.serverType === 'MariaDB',
			host: server.host + (server.port ? ':' + server.port : '')
		},
		appVersion: getAppInfo().appVersion,
		asFile: parsed.output === 'download'
	};

	try {
		if (parsed.output === 'view') {
			const result = await exportToText(env, req, VIEW_LIMIT);
			if (request.headers.get('accept')?.includes('application/json')) return json(result);
			return new Response(result.text, {
				headers: {
					'content-type': 'text/plain; charset=utf-8',
					'x-content-type-options': 'nosniff'
				}
			});
		}
		const plugin = req.plugin;
		const named = exportFilename(
			parsed.filenameTemplate ||
				(level === 'server' ? '@SERVER@' : level === 'database' ? '@DATABASE@' : '@TABLE@'),
			{
				server: server.host,
				verbose: server.verbose,
				database: level === 'server' ? '' : params.db,
				table: params.table ?? '',
				app: `svelteMyAdmin ${env.appVersion}`
			},
			plugin.extension,
			plugin.mimeType,
			parsed.compression
		);
		const entry = named.filename.replace(/\.(gz|zip)$/, '');
		const body = await exportToStream(env, req, {
			compression: parsed.compression,
			charset: parsed.charset,
			zipEntryName: entry
		});
		return new Response(body, {
			headers: {
				'content-type': named.mimeType,
				'content-disposition': `attachment; filename="${named.filename}"`,
				'cache-control': 'no-store',
				'x-content-type-options': 'nosniff'
			}
		});
	} catch (e) {
		if (e && typeof e === 'object' && 'status' in e && 'body' in e) throw e;
		const message = e instanceof Error ? e.message : 'Export failed';
		error(400, `Export failed: ${message}`.slice(0, 500));
	}
}

// ---- templates ----------------------------------------------------------------------------------

const dataSchema = z
	.record(z.string(), z.union([z.string(), z.boolean(), z.null(), z.array(z.string())]))
	.refine((d) => JSON.stringify(d).length < 60_000, 'Template too large');

const templateSchema = z.discriminatedUnion('action', [
	z.object({
		action: z.literal('create'),
		name: z.string().trim().min(1).max(64),
		data: dataSchema
	}),
	z.object({ action: z.literal('update'), id: z.number().int().positive(), data: dataSchema }),
	z.object({ action: z.literal('delete'), id: z.number().int().positive() }),
	z.object({ action: z.literal('load'), id: z.number().int().positive() })
]);

export async function handleTemplatePost(
	event: RequestEvent,
	level: ExportLevel
): Promise<Response> {
	const { locals } = event;
	const parsed = templateSchema.safeParse(await event.request.json().catch(() => null));
	if (!parsed.success) return json({ ok: false, message: 'Invalid request.' }, { status: 400 });
	const input = parsed.data;
	const templates = await listTemplates(locals, level);
	if (templates === null) {
		return json(
			{ ok: false, message: 'Export templates need the configuration storage.' },
			{ status: 409 }
		);
	}
	let message = '';
	let id: number | undefined;
	let data: Record<string, unknown> | undefined;
	switch (input.action) {
		case 'create': {
			const created = await createTemplate(locals, level, input.name, input.data);
			if (created === null)
				return json(
					{ ok: false, message: 'Could not create the template (name already used?).' },
					{ status: 409 }
				);
			id = created;
			message = `Template "${input.name}" was created.`;
			break;
		}
		case 'update':
			if (!(await updateTemplate(locals, input.id, input.data))) {
				return json({ ok: false, message: 'Template not found.' }, { status: 404 });
			}
			id = input.id;
			message = 'Template was updated.';
			break;
		case 'delete':
			if (!(await deleteTemplate(locals, input.id))) {
				return json({ ok: false, message: 'Template not found.' }, { status: 404 });
			}
			message = 'Template was deleted.';
			break;
		case 'load': {
			const loaded = await loadTemplate(locals, input.id);
			if (!loaded) return json({ ok: false, message: 'Template not found.' }, { status: 404 });
			id = input.id;
			data = loaded;
			message = 'Template was loaded.';
		}
	}
	return json({ ok: true, message, id, data, templates: await listTemplates(locals, level) });
}
