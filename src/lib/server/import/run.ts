/**
 * Execution state of one import (the globals of libraries/classes/Import.php: skip_queries,
 * executed_queries, timeout_passed, error, ...): runs statements on the user's connection one by
 * one, stops at the first error, honours the skip count and the time budget.
 */
import { SOURCE_TRANSLATOR, type Translator } from '#lib/i18n/translator.ts';
import type { Readable } from 'node:stream';
import type { Connection } from 'mysql2/promise';
import type { ImportErrorInfo, ImportStatementInfo, ImportWarningInfo } from '#lib/import/types.ts';

export const MAX_KEPT_STATEMENTS = 100;
export const MAX_KEPT_WARNINGS = 50;
const EXCERPT = 240;

export const excerpt = (sql: string): string =>
	sql.length > EXCERPT ? sql.slice(0, EXCERPT) + '…' : sql;

interface SqlError {
	errno?: number;
	sqlMessage?: string;
	message?: string;
}

export interface RunOptions {
	skip: number;
	/** Stop (resumably) once this much time passed; 0 = never. */
	timeBudgetMs: number;
	onProgress?: () => void;
}

const STRUCTURE_RE = /^\s*(?:\/\*.*?\*\/\s*)*(?:CREATE|DROP|ALTER|RENAME)\s/is;
const IDENT = '(?:`(?:[^`]|``)+`|[\\w$]+)';
const CREATE_RE = new RegExp(
	`^\\s*CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:ALGORITHM\\s*=\\s*\\w+\\s+)?(TABLE|VIEW|DATABASE|SCHEMA)\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${IDENT})(?:\\s*\\.\\s*(${IDENT}))?`,
	'i'
);
const unquote = (id: string): string =>
	id.startsWith('`') ? id.slice(1, -1).replaceAll('``', '`') : id;
const USE_RE = /^\s*USE\s+(?:`((?:[^`]|``)+)`|([^\s;]+))/i;

export class ImportRun {
	/** Units (statements / rows) consumed so far, skipped ones included. */
	seen = 0;
	skipped = 0;
	/** Queries executed successfully (rows count individually). */
	queries = 0;
	affectedRows = 0;
	error: ImportErrorInfo | null = null;
	interrupted = false;
	structureChanged = false;
	currentDb: string | null;
	readonly statements: ImportStatementInfo[] = [];
	statementsTruncated = false;
	readonly warnings: ImportWarningInfo[] = [];
	readonly created = new Map<string, Set<string>>();
	private readonly started = Date.now();
	private lastProgress = 0;
	/** Translator for the messages stored in the result (set by the orchestrator). */
	tr: Translator = SOURCE_TRANSLATOR;

	get skip(): number {
		return this.opts.skip;
	}

	constructor(
		readonly conn: Connection,
		private readonly opts: RunOptions,
		initialDb: string | null
	) {
		this.currentDb = initialDb;
	}

	get elapsedMs(): number {
		return Date.now() - this.started;
	}

	/** Anything that ends the import: an error or an interruption. */
	get stopped(): boolean {
		return this.error !== null || this.interrupted;
	}

	/** Mark the import as interrupted when the time budget is used up. Call between units only. */
	checkTime(): boolean {
		// Always make progress: a run that executed nothing yet is never interrupted.
		if (this.queries > 0 && this.opts.timeBudgetMs > 0 && this.elapsedMs > this.opts.timeBudgetMs) {
			this.interrupted = true;
		}
		return this.interrupted;
	}

	/** Consume one unit; true when it must not be executed ("skip this number of queries"). */
	takeSkip(): boolean {
		this.seen++;
		if (this.seen <= this.opts.skip) {
			this.skipped++;
			return true;
		}
		return false;
	}

	noteCreated(db: string, table?: string) {
		this.structureChanged = true;
		let set = this.created.get(db);
		if (!set) this.created.set(db, (set = new Set()));
		if (table) set.add(table);
	}

	private progress() {
		const now = Date.now();
		if (now - this.lastProgress < 250) return;
		this.lastProgress = now;
		this.opts.onProgress?.();
	}

	/**
	 * Execute one statement. Returns false (and records the error) when it failed.
	 * @param units how many queries it stands for (a multi-row INSERT counts its rows)
	 */
	async exec(
		sql: string,
		line: number | null,
		units = 1,
		extra: { infileStreamFactory?: (path: string) => Readable } = {}
	): Promise<boolean> {
		let affected = 0;
		let rows: number | null = null;
		let warningCount = 0;
		try {
			const [res] = await this.conn.query({ sql, ...extra });
			if (Array.isArray(res)) {
				rows = res.length;
			} else if (res && typeof res === 'object') {
				const h = res as { affectedRows?: number; warningStatus?: number };
				affected = Number(h.affectedRows ?? 0);
				warningCount = Number(h.warningStatus ?? 0);
			}
		} catch (e) {
			const err = e as SqlError;
			this.error = {
				line,
				statement: excerpt(sql),
				errno: err.errno ?? null,
				message: err.sqlMessage ?? err.message ?? 'Unknown error'
			};
			return false;
		}
		this.queries += units;
		this.affectedRows += affected;
		if (STRUCTURE_RE.test(sql)) this.structureChanged = true;
		const create = CREATE_RE.exec(sql);
		if (create) {
			const kind = create[1].toUpperCase();
			if (kind === 'DATABASE' || kind === 'SCHEMA') this.noteCreated(unquote(create[2]));
			else {
				const db = create[3] ? unquote(create[2]) : this.currentDb;
				if (db) this.noteCreated(db, unquote(create[3] ?? create[2]));
			}
		}
		const use = USE_RE.exec(sql);
		if (use) {
			this.currentDb = (use[1] ?? use[2]).replaceAll('``', '`');
			this.structureChanged = true;
		}
		if (this.statements.length < MAX_KEPT_STATEMENTS) {
			this.statements.push({
				line,
				sql: excerpt(sql),
				affectedRows: affected,
				rows,
				warnings: warningCount
			});
		} else {
			this.statementsTruncated = true;
		}
		if (warningCount > 0 && this.warnings.length < MAX_KEPT_WARNINGS) {
			try {
				const [w] = await this.conn.query('SHOW WARNINGS');
				for (const r of w as { Level: string; Code: number; Message: string }[]) {
					if (this.warnings.length >= MAX_KEPT_WARNINGS) break;
					this.warnings.push({ level: r.Level, code: Number(r.Code), message: r.Message, line });
				}
			} catch {
				/* warnings are informational */
			}
		}
		this.progress();
		return true;
	}

	/** Record a format (non SQL) error. */
	fail(message: string, line: number | null = null) {
		this.error = { line, statement: '', errno: null, message };
	}
}
