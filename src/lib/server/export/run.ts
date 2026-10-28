/**
 * Export framework: drives an ExportPlugin through the hooks in the order of phpMyAdmin's
 * Export::exportServer / exportDatabase / exportTable / exportRaw and streams the result.
 *
 *   const req: ExportRequest = { scope: 'database', plugin, options, structureOrData: 'structure_and_data', db: 'x' };
 *   await exportToStream(env, req, { compression: 'gzip', charset: 'utf-8', zipEntryName: 'x.sql' })  // Response body
 *   await exportToText(env, req, 2_000_000)                                                          // view as text
 */
import { Readable } from 'node:stream';
import type { Connection } from 'mysql2/promise';
import { escapeId, escapeQualified } from '#lib/sql/escape.ts';
import { IGNORES_STRUCTURE_OR_DATA } from './registry.ts';
import { openRowStream, type OpenedRows } from './rows.ts';
import { createSink, normalizeCharset } from './sink.ts';
import type { Compression } from './filename.ts';
import type {
	ExportContext,
	ExportOptionValues,
	ExportPlugin,
	ExportScope,
	ExportTableRef,
	StructureOrData
} from './types.ts';

export interface ExportTableSelection {
	name: string;
	structure: boolean;
	data: boolean;
}

export interface ExportRequest {
	scope: ExportScope;
	plugin: ExportPlugin;
	/** Plugin option values (defaults already merged). */
	options: ExportOptionValues;
	structureOrData: StructureOrData;
	/** Databases to export (server scope), or the single database of the other scopes. */
	databases: string[];
	/** Database scope: tables with their structure/data flags; undefined = every table, both. */
	tables?: ExportTableSelection[];
	/** Table scope. */
	table?: string;
	/** Table scope: already verified row conditions (`WHERE (a) OR (b)`). */
	where?: string[];
	/** Table scope: LIMIT from/to (`allRows` false). */
	allRows?: boolean;
	limitFrom?: number;
	limitTo?: number;
	/** Raw scope: the query; table scope: query whose rows replace `SELECT * FROM table`. */
	sqlQuery?: string;
}

export interface ExportEnv {
	conn: Connection;
	server: { version: string; isMariaDb: boolean; host: string };
	appVersion: string;
	now?: Date;
	/** false for "view as text". */
	asFile: boolean;
	charset?: string;
}

interface TableMeta {
	name: string;
	kind: 'table' | 'view';
	engine: string | null;
}

async function listTableMeta(conn: Connection, db: string): Promise<TableMeta[]> {
	const [rows] = await conn.query(
		'SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine FROM information_schema.TABLES ' +
			'WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
		[db]
	);
	return (rows as { name: string; type: string; engine: string | null }[]).map((r) => ({
		name: String(r.name),
		kind: String(r.type).includes('VIEW') ? 'view' : 'table',
		engine: r.engine === null ? null : String(r.engine)
	}));
}

/** Columns that can be selected (generated columns are skipped like Table::getNonGeneratedColumns). */
export async function nonGeneratedColumns(
	conn: Connection,
	db: string,
	table: string
): Promise<string[]> {
	const [rows] = await conn.query(`SHOW COLUMNS FROM ${escapeQualified(db, table)}`);
	return (rows as { Field: string; Extra: string }[])
		.filter((c) => {
			const extra = String(c.Extra ?? '');
			const generated = extra.includes('GENERATED') || extra.includes('VIRTUAL');
			return !(generated && !extra.includes('DEFAULT_GENERATED'));
		})
		.map((c) => String(c.Field));
}

/** Thrown inside the driver to stop quietly (text view cap reached). */
class StopExport extends Error {}

/** Drive the plugin; every byte goes through `write`. */
export async function driveExport(
	env: ExportEnv,
	req: ExportRequest,
	write: (chunk: string | Uint8Array) => Promise<void>
): Promise<void> {
	const p = req.plugin;
	const plugin = p;
	const always = IGNORES_STRUCTURE_OR_DATA.has(p.id);
	const wantsStructure =
		p.supports.structure && (always || req.structureOrData !== 'data') && req.scope !== 'raw';
	const wantsData = p.supports.data && (always || req.structureOrData !== 'structure');
	const ctx: ExportContext = {
		write,
		conn: env.conn,
		scope: req.scope,
		options: { ...req.options, structure_or_data: req.structureOrData },
		crlf: plugin.crlf ?? '\n',
		server: env.server,
		appVersion: env.appVersion,
		now: env.now ?? new Date(),
		asFile: env.asFile,
		charset: normalizeCharset(env.charset),
		structureOrData: req.structureOrData
	};

	const streamRows = async (db: string, table: string, sql: string, ref: ExportTableRef) => {
		const opened: OpenedRows = await openRowStream(env.conn, sql);
		try {
			await p.data!(ctx, {
				ref: { ...ref, db, table },
				fields: opened.fields,
				rows: opened.rows,
				sql
			});
		} finally {
			opened.destroy();
		}
	};

	const exportDatabase = async (db: string, selection: ExportTableSelection[] | undefined) => {
		const metas = await listTableMeta(env.conn, db);
		const chosen = metas
			.map((m) => {
				const sel = selection?.find((s) => s.name === m.name);
				if (selection && !sel) return null;
				return {
					meta: m,
					structure: wantsStructure && (sel ? sel.structure : true),
					data: wantsData && (sel ? sel.data : true)
				};
			})
			.filter((x) => x !== null);
		ctx.dataTables = new Set(chosen.filter((c) => c.data).map((c) => c.meta.name));

		await p.dbHeader?.(ctx, db);
		await p.dbCreate?.(ctx, db);
		if (wantsStructure) await p.routines?.(ctx, db);

		const structured: ExportTableRef[] = [];
		for (const { meta, structure, data } of chosen) {
			const ref: ExportTableRef = { db, table: meta.name, kind: meta.kind };
			if (structure) {
				await p.structure?.(ctx, ref, req.structureOrData);
				structured.push(ref);
			}
			const isMerge = (meta.engine ?? '').toUpperCase() === 'MRG_MYISAM';
			if (data && meta.kind === 'table' && !isMerge && p.data) {
				const cols = await nonGeneratedColumns(env.conn, db, meta.name);
				const sql = `SELECT ${cols.map(escapeId).join(', ')} FROM ${escapeQualified(db, meta.name)}`;
				await streamRows(db, meta.name, sql, ref);
			}
			if (structure && meta.kind === 'table') await p.triggers?.(ctx, ref);
		}
		await p.dbAfterTables?.(ctx, db, structured);
		await p.dbFooter?.(ctx, db);
		if (wantsStructure) await p.events?.(ctx, db);
	};

	const exportTable = async (db: string, table: string) => {
		const metas = await listTableMeta(env.conn, db);
		const meta = metas.find((m) => m.name === table);
		if (!meta) throw new Error(`Table ${db}.${table} does not exist`);
		const ref: ExportTableRef = { db, table, kind: meta.kind };
		ctx.dataTables = new Set([table]);

		let limit = '';
		if (req.allRows === false && (req.limitTo ?? 0) > 0 && (req.limitFrom ?? 0) >= 0) {
			limit = ` LIMIT ${req.limitFrom! > 0 ? req.limitFrom + ', ' : ''}${req.limitTo}`;
		}

		await p.dbHeader?.(ctx, db);
		if (wantsStructure) await p.structure?.(ctx, ref, req.structureOrData);
		if (wantsData && p.data) {
			let sql: string;
			if (req.sqlQuery) {
				sql = (limit ? req.sqlQuery.replace(/;\s*$/, '') : req.sqlQuery) + limit;
				await env.conn.query(`USE ${escapeId(db)}`);
			} else {
				const cols = await nonGeneratedColumns(env.conn, db, table);
				const where = req.where?.length
					? ' WHERE ' + req.where.map((w) => `(${w})`).join(' OR ')
					: '';
				sql = `SELECT ${cols.map(escapeId).join(', ')} FROM ${escapeQualified(db, table)}${where}${limit}`;
			}
			await streamRows(db, table, sql, ref);
		}
		if (wantsStructure && meta.kind === 'table') await p.triggers?.(ctx, ref);
		if (wantsStructure) await p.dbAfterTables?.(ctx, db, [ref]);
		await p.dbFooter?.(ctx, db);
	};

	const exportRaw = async () => {
		const sql = req.sqlQuery ?? '';
		const db = req.databases[0] ?? '';
		if (db) await env.conn.query(`USE ${escapeId(db)}`);
		// open first: syntax errors surface before any output
		const opened = await openRowStream(env.conn, sql);
		try {
			await p.header?.(ctx);
			const table = opened.originTable;
			await p.data?.(ctx, {
				ref: { db, table, kind: 'table' },
				fields: opened.fields,
				rows: opened.rows,
				sql
			});
			await p.footer?.(ctx);
		} finally {
			opened.destroy();
		}
	};

	if (req.scope === 'raw') return exportRaw();

	await p.header?.(ctx);
	if (req.scope === 'server') {
		for (const db of req.databases) await exportDatabase(db, undefined);
	} else if (req.scope === 'database') {
		await exportDatabase(req.databases[0], req.tables);
	} else {
		await exportTable(req.databases[0], req.table ?? '');
	}
	await p.footer?.(ctx);
}

export interface StreamOptions {
	compression: Compression;
	charset: string;
	zipEntryName: string;
}

/**
 * Start a streamed download. Rejects when the export fails before the first byte is produced (so
 * the caller can answer with an HTTP error); later failures abort the body stream.
 */
export async function exportToStream(
	env: ExportEnv,
	req: ExportRequest,
	opts: StreamOptions
): Promise<ReadableStream<Uint8Array>> {
	const sink = createSink(opts);
	const done = driveExport({ ...env, charset: opts.charset, asFile: true }, req, (c) =>
		sink.write(c)
	).then(
		() => sink.end(),
		(e: unknown) => {
			sink.destroy(e instanceof Error ? e : new Error(String(e)));
			throw e;
		}
	);
	const early = await Promise.race([
		sink.firstOutput.then(() => null),
		done.then(
			() => null,
			(e: unknown) => e
		)
	]);
	if (early) throw early;
	done.catch(() => {});
	return Readable.toWeb(sink.readable) as unknown as ReadableStream<Uint8Array>;
}

/** Export into memory for "view as text", capped at `maxChars`. */
export async function exportToText(
	env: ExportEnv,
	req: ExportRequest,
	maxChars: number
): Promise<{ text: string; truncated: boolean }> {
	if (req.plugin.binary) throw new Error('This format cannot be displayed as text');
	let text = '';
	let truncated = false;
	try {
		await driveExport({ ...env, asFile: false }, req, async (chunk) => {
			if (typeof chunk !== 'string') throw new Error('This format cannot be displayed as text');
			text += chunk;
			if (text.length > maxChars) {
				text = text.slice(0, maxChars);
				truncated = true;
				throw new StopExport();
			}
		});
	} catch (e) {
		if (!(e instanceof StopExport)) throw e;
	}
	return { text, truncated };
}
