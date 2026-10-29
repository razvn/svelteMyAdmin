/**
 * Insert / edit rows, server side: column metadata, foreign-key dropdowns, row loading by signed
 * clause, form-data parsing and execution. Mirrors Controllers/Table/ChangeController.php and
 * ReplaceController.php. SQL is built by the pure module `#lib/sql/insert-edit.ts`.
 */
import { createConnection, type Connection } from '../db/connection';
import { escapeId, escapeQualified, quoteValue } from '../db/escape';
import type { AppConfig, ServerConfig } from '../config/schema';
import {
	InsertEditError,
	blankCell,
	buildInsert,
	buildUpdate,
	defaultFunction,
	isProtected,
	renderStatement,
	toColumnMeta,
	typeClass,
	type CellInput,
	type ColumnMeta,
	type ForeignInfo,
	type FormColumn,
	type FormCell,
	type ProtectBinary,
	type Statement
} from '#lib/sql/insert-edit.ts';
import { N_ } from '#lib/i18n/translator.ts';

type Row = Record<string, unknown>;

export interface FormRow {
	cells: FormCell[];
	/** Stored size of protected binary columns, per column index. */
	sizes: (number | null)[];
	/** Verified clause + signature of the edited row (edit mode). */
	where?: string;
	sig?: string;
	/** Row whose protected binaries are copied when inserting as new. */
	source?: { where: string; sig: string };
}

async function query(conn: Connection, sql: string, params: unknown[] = []): Promise<Row[]> {
	const [rows] = await conn.query(sql, params);
	return rows as Row[];
}

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export async function loadColumns(
	conn: Connection,
	db: string,
	table: string
): Promise<ColumnMeta[]> {
	const rows = await query(conn, `SHOW FULL COLUMNS FROM ${escapeQualified(db, table)}`);
	return rows.map((r) =>
		toColumnMeta({
			field: s(r.Field),
			type: s(r.Type),
			null: s(r.Null) === 'YES',
			key: s(r.Key),
			default: r.Default === null || r.Default === undefined ? null : s(r.Default),
			extra: s(r.Extra),
			comment: s(r.Comment)
		})
	);
}

// --- foreign keys ----------------------------------------------------------------------------

interface ForeignRef {
	db: string;
	table: string;
	column: string;
}

/** InnoDB single-column foreign keys plus pma__relation (when the configuration storage is usable). */
async function loadForeigners(
	conn: Connection,
	server: ServerConfig,
	db: string,
	table: string
): Promise<{ refs: Map<string, ForeignRef>; ctrl: Connection | null }> {
	const refs = new Map<string, ForeignRef>();
	const fk = await query(
		conn,
		`SELECT k.COLUMN_NAME AS col, k.REFERENCED_TABLE_SCHEMA AS fdb, k.REFERENCED_TABLE_NAME AS ftable,
		        k.REFERENCED_COLUMN_NAME AS fcol
		 FROM information_schema.KEY_COLUMN_USAGE k
		 WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ? AND k.REFERENCED_TABLE_NAME IS NOT NULL
		   AND (SELECT COUNT(*) FROM information_schema.KEY_COLUMN_USAGE k2
		        WHERE k2.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND k2.CONSTRAINT_NAME = k.CONSTRAINT_NAME
		          AND k2.TABLE_NAME = k.TABLE_NAME) = 1`,
		[db, table]
	);
	for (const r of fk) {
		refs.set(s(r.col), { db: s(r.fdb), table: s(r.ftable), column: s(r.fcol) });
	}
	let ctrl: Connection | null = null;
	if (server.controluser && server.pmadb) {
		try {
			ctrl = await createConnection(server, server.controluser, server.controlpass);
			const rel = await query(
				ctrl,
				`SELECT master_field, foreign_db, foreign_table, foreign_field FROM ${escapeQualified(server.pmadb, server.relation)}
				 WHERE master_db = ? AND master_table = ?`,
				[db, table]
			);
			for (const r of rel) {
				if (!refs.has(s(r.master_field))) {
					refs.set(s(r.master_field), {
						db: s(r.foreign_db),
						table: s(r.foreign_table),
						column: s(r.foreign_field)
					});
				}
			}
		} catch {
			if (ctrl) await ctrl.end().catch(() => {});
			ctrl = null;
		}
	}
	return { refs, ctrl };
}

async function displayColumn(
	conn: Connection,
	ctrl: Connection | null,
	server: ServerConfig,
	ref: ForeignRef
): Promise<string | null> {
	if (ctrl) {
		try {
			const r = await query(
				ctrl,
				`SELECT display_field FROM ${escapeQualified(server.pmadb, server.table_info)} WHERE db_name = ? AND table_name = ?`,
				[ref.db, ref.table]
			);
			if (r[0] && s(r[0].display_field) !== '') return s(r[0].display_field);
		} catch {
			// storage table missing: fall through
		}
	}
	const cols = await query(
		conn,
		'SELECT COLUMN_NAME AS name, DATA_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION',
		[ref.db, ref.table]
	);
	for (const c of cols) {
		if (typeClass(s(c.type)) === 'CHAR' && s(c.name) !== ref.column) return s(c.name);
	}
	return null;
}

const keyText = (v: unknown): string => (Buffer.isBuffer(v) ? `0x${v.toString('hex')}` : s(v));

async function loadForeignInfo(
	conn: Connection,
	ctrl: Connection | null,
	server: ServerConfig,
	ref: ForeignRef,
	config: Pick<AppConfig, 'ForeignKeyMaxLimit' | 'ForeignKeyDropdownOrder'>
): Promise<ForeignInfo> {
	const base = { db: ref.db, table: ref.table, column: ref.column };
	const from = escapeQualified(ref.db, ref.table);
	const limit = config.ForeignKeyMaxLimit;
	try {
		if (limit >= 0) {
			const [c] = await query(
				conn,
				`SELECT COUNT(*) AS n FROM (SELECT 1 FROM ${from} LIMIT ${Number(limit) + 1}) x`
			);
			if (Number(c.n) > limit) return { ...base, options: null };
		}
		const display = await displayColumn(conn, ctrl, server, ref);
		const rows = await query(
			conn,
			`SELECT ${escapeId(ref.column)} AS k${display ? `, ${escapeId(display)} AS d` : ''} FROM ${from}`
		);
		const order = config.ForeignKeyDropdownOrder[0] ?? 'content-id';
		const opts = rows.map((r) => {
			const k = keyText(r.k);
			const d = display && r.d !== null && r.d !== undefined ? keyText(r.d) : '';
			let label = k;
			if (d !== '') label = order === 'id-content' ? `${k} - ${d}` : `${d} - ${k}`;
			return { value: k, label, sort: order === 'id-content' || d === '' ? k : d };
		});
		const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
		opts.sort((a, b) => collator.compare(a.sort, b.sort));
		return { ...base, options: opts.map(({ value, label }) => ({ value, label })) };
	} catch {
		return { ...base, options: null };
	}
}

export interface InsertSettings {
	ProtectBinary: ProtectBinary;
	DefaultFunctions: Record<string, string>;
	ForeignKeyMaxLimit: number;
	ForeignKeyDropdownOrder: string[];
}

export async function buildFormColumns(
	conn: Connection,
	server: ServerConfig,
	db: string,
	table: string,
	columns: ColumnMeta[],
	cfg: InsertSettings,
	insertMode: boolean
): Promise<FormColumn[]> {
	const { refs, ctrl } = await loadForeigners(conn, server, db, table);
	try {
		let timestampSeen = false;
		const out: FormColumn[] = [];
		for (const c of columns) {
			const first = c.trueType === 'timestamp' && !timestampSeen;
			if (c.trueType === 'timestamp') timestampSeen = true;
			const ref = refs.get(c.name);
			const foreign = ref ? await loadForeignInfo(conn, ctrl, server, ref, cfg) : null;
			out.push({
				...c,
				protected: isProtected(c, cfg.ProtectBinary),
				defaultFunction: defaultFunction(c, {
					insertMode,
					firstTimestamp: first,
					config: cfg.DefaultFunctions,
					hasForeign: foreign?.options != null
				}),
				foreign
			});
		}
		return out;
	} finally {
		await ctrl?.end().catch(() => {});
	}
}

// --- rows ------------------------------------------------------------------------------------

function selectList(columns: ColumnMeta[]): string {
	return columns
		.map((c) =>
			c.kind === 'spatial'
				? `ST_AsText(${escapeId(c.name)}) AS ${escapeId(c.name)}`
				: escapeId(c.name)
		)
		.join(', ');
}

function bitString(buf: Buffer, length: number): string {
	let n = 0n;
	for (const b of buf) n = (n << 8n) | BigInt(b);
	return n.toString(2).padStart(length || buf.length * 8, '0');
}

/** InsertEdit::getSpecialCharsAndBackupFieldForExistingRow(). */
export function cellFromValue(
	col: FormColumn,
	raw: unknown,
	opts: { blankAutoIncrement?: boolean; func?: string } = {}
): { cell: FormCell; size: number | null } {
	let size: number | null = null;
	let value = '';
	const isNull = raw === null || raw === undefined;
	if (!isNull) {
		if (Buffer.isBuffer(raw)) {
			size = raw.length;
			if (col.kind === 'bit') value = bitString(raw, col.length);
			else if (col.protected) value = '';
			else value = `0x${raw.toString('hex')}`;
		} else {
			value = String(raw);
		}
	}
	const set = col.kind === 'set' && !isNull && value !== '' ? value.split(',') : [];
	if (opts.blankAutoIncrement && col.autoIncrement && col.key === 'PRI') {
		return {
			cell: { value: '', setValues: [], isNull: false, func: '', salt: '' },
			size: null
		};
	}
	return {
		cell: {
			value,
			setValues: set,
			isNull,
			func: opts.func ?? '',
			salt: '',
			prev: col.kind === 'set' ? set.join(',') : value,
			prevNull: isNull
		},
		size
	};
}

/** Load rows by (already verified) WHERE clauses. Missing rows are reported, not fatal. */
export async function loadRowsByClauses(
	conn: Connection,
	db: string,
	table: string,
	columns: FormColumn[],
	clauses: { where: string; sig: string }[],
	opts: { copy: boolean; defaultFunctions: Record<string, string> }
): Promise<{ rows: FormRow[]; missing: string[] }> {
	const rows: FormRow[] = [];
	const missing: string[] = [];
	for (const c of clauses) {
		const res = await query(
			conn,
			`SELECT ${selectList(columns)} FROM ${escapeQualified(db, table)} WHERE ${c.where} LIMIT 1`
		);
		if (res.length === 0) {
			missing.push(c.where);
			continue;
		}
		const cells: FormCell[] = [];
		const sizes: (number | null)[] = [];
		columns.forEach((col) => {
			const fn = opts.copy ? '' : col.kind === 'spatial' ? col.defaultFunction : '';
			const { cell, size } = cellFromValue(col, res[0][col.name], {
				blankAutoIncrement: opts.copy,
				func: fn
			});
			if (opts.copy) {
				delete cell.prev;
				delete cell.prevNull;
			}
			cells.push(cell);
			sizes.push(size);
		});
		rows.push(
			opts.copy
				? { cells, sizes, source: c }
				: { cells, sizes, where: c.where, sig: c.sig, source: c }
		);
	}
	return { rows, missing };
}

export function blankRow(columns: FormColumn[], now = new Date()): FormRow {
	return {
		cells: columns.map((c) => blankCell(c, { func: c.defaultFunction, now })),
		sizes: columns.map(() => null)
	};
}

// --- unique condition (for "edit next row") --------------------------------------------------

function valueLiteral(v: unknown): string {
	return quoteValue(v as never);
}

/** WHERE clause identifying a row: primary/unique key columns when available, else all columns. */
export function uniqueCondition(columns: ColumnMeta[], row: Row): string {
	const keyCols = columns.filter((c) => c.key === 'PRI');
	const use = keyCols.length > 0 ? keyCols : columns.filter((c) => !c.generated);
	return use
		.map((c) => {
			const v = row[c.name];
			return v === null || v === undefined
				? `${escapeId(c.name)} IS NULL`
				: `${escapeId(c.name)} = ${valueLiteral(v)}`;
		})
		.join(' AND ');
}

/** The row after the given one in primary key order (needs a primary key), as a unique clause. */
export async function nextRowClause(
	conn: Connection,
	db: string,
	table: string,
	columns: ColumnMeta[],
	where: string
): Promise<string | null> {
	const pk = columns.filter((c) => c.key === 'PRI');
	if (pk.length === 0) return null;
	const names = pk.map((c) => escapeId(c.name)).join(', ');
	const from = escapeQualified(db, table);
	const cur = await query(conn, `SELECT ${names} FROM ${from} WHERE ${where} LIMIT 1`);
	if (cur.length === 0) return null;
	const tuple = pk.map((c) => valueLiteral(cur[0][c.name])).join(', ');
	const next = await query(
		conn,
		`SELECT * FROM ${from} WHERE (${names}) > (${tuple}) ORDER BY ${names} LIMIT 1`
	);
	return next.length === 0 ? null : uniqueCondition(columns, next[0]);
}

// --- submission ------------------------------------------------------------------------------

export type SubmitType = 'save' | 'insert' | 'insertignore' | 'showinsert';

export interface Submission {
	submitType: SubmitType;
	rows: {
		index: number;
		where: string | null;
		sig: string | null;
		source: { where: string; sig: string } | null;
		ignore: boolean;
		cells: CellInput[];
	}[];
}

const MAX_ROWS = 500;

/** Read the form posted by the page; throws InsertEditError for malformed input. */
export async function parseSubmission(form: FormData, columns: FormColumn[]): Promise<Submission> {
	const submit = s(form.get('submit_type'));
	const submitType: SubmitType = (
		['save', 'insert', 'insertignore', 'showinsert'] as const
	).includes(submit as SubmitType)
		? (submit as SubmitType)
		: 'save';
	const n = Number(form.get('rows'));
	if (!Number.isInteger(n) || n < 1 || n > MAX_ROWS)
		throw new InsertEditError(N_('Invalid row count.'));
	const text = (k: string) => {
		const v = form.get(k);
		return typeof v === 'string' ? v : null;
	};
	const rows: Submission['rows'] = [];
	for (let r = 0; r < n; r++) {
		const where = text(`where_${r}`);
		const sig = text(`sig_${r}`);
		const sw = text(`src_${r}`);
		const ss = text(`srcsig_${r}`);
		const cells: CellInput[] = [];
		for (const [c, column] of columns.entries()) {
			const key = `${r}_${c}`;
			const file = form.get(`u_${key}`);
			let upload: Buffer | null = null;
			if (file && typeof file !== 'string' && file.size > 0) {
				upload = Buffer.from(await file.arrayBuffer());
			}
			const cell: FormCell = {
				value: text(`v_${key}`) ?? '',
				setValues:
					column.kind === 'set'
						? form.getAll(`v_${key}`).filter((x): x is string => typeof x === 'string')
						: [],
				isNull: form.has(`n_${key}`),
				func: text(`f_${key}`) ?? '',
				salt: text(`s_${key}`) ?? ''
			};
			const prev = text(`p_${key}`);
			if (prev !== null) {
				cell.prev = prev;
				cell.prevNull = form.has(`pn_${key}`);
			}
			cells.push({ column, cell, isProtected: column.protected, upload });
		}
		rows.push({
			index: r,
			where,
			sig,
			source: sw !== null && ss !== null ? { where: sw, sig: ss } : null,
			ignore: form.has(`ignore_${r}`),
			cells
		});
	}
	return { submitType, rows };
}

export interface ExecuteResult {
	statements: string[];
	affectedRows: number;
	insertId: number | null;
	warnings: string[];
	/** True when nothing was executed (preview or no change). */
	executed: boolean;
	noChange: boolean;
}

/** Protected binary content of a source row, for "insert as new row". */
export async function loadProtectedOriginals(
	conn: Connection,
	db: string,
	table: string,
	columns: FormColumn[],
	where: string
): Promise<Map<string, Buffer>> {
	const prot = columns.filter((c) => c.protected);
	const out = new Map<string, Buffer>();
	if (prot.length === 0) return out;
	const res = await query(
		conn,
		`SELECT ${prot.map((c) => escapeId(c.name)).join(', ')} FROM ${escapeQualified(db, table)} WHERE ${where} LIMIT 1`
	);
	for (const c of prot) {
		const v = res[0]?.[c.name];
		if (Buffer.isBuffer(v)) out.set(c.name, v);
	}
	return out;
}

/**
 * Build the statements for a submission. `verify` checks a clause signature. Throws
 * InsertEditError when a clause is missing or forged.
 */
export async function buildStatements(
	conn: Connection,
	db: string,
	table: string,
	columns: FormColumn[],
	sub: Submission,
	verify: (clause: string, sig: string | null) => boolean
): Promise<{ statements: Statement[]; skipped: number }> {
	const statements: Statement[] = [];
	let skipped = 0;
	const hasWhere = sub.rows.some((r) => r.where !== null);
	const asInsert = !hasWhere || sub.submitType === 'insert' || sub.submitType === 'insertignore';
	const insertRows: CellInput[][] = [];
	for (const row of sub.rows) {
		if (row.where !== null && !verify(row.where, row.sig)) {
			throw new InsertEditError(N_('The row reference is invalid or has been tampered with.'));
		}
		if (row.source && !verify(row.source.where, row.source.sig)) {
			throw new InsertEditError(N_('The row reference is invalid or has been tampered with.'));
		}
		if (!hasWhere && row.ignore) {
			skipped++;
			continue;
		}
		const srcWhere = row.where ?? row.source?.where ?? null;
		if (asInsert) {
			if (srcWhere && columns.some((c) => c.protected)) {
				const orig = await loadProtectedOriginals(conn, db, table, columns, srcWhere);
				for (const cell of row.cells) {
					cell.protectedOriginal = orig.get(cell.column.name) ?? null;
				}
			}
			// a copy of an edited row must not carry the "previous value" bookkeeping
			insertRows.push(row.cells);
		} else {
			const st = buildUpdate(db, table, row.cells, row.where!);
			if (st) statements.push(st);
		}
	}
	if (asInsert) {
		const st = buildInsert(db, table, insertRows, { ignore: sub.submitType === 'insertignore' });
		if (st && insertRows.length > 0) statements.push(st);
	}
	return { statements, skipped };
}

export async function executeStatements(
	conn: Connection,
	statements: Statement[],
	preview: boolean
): Promise<ExecuteResult> {
	const rendered = statements.map(renderStatement);
	if (preview || statements.length === 0) {
		return {
			statements: rendered,
			affectedRows: 0,
			insertId: null,
			warnings: [],
			executed: false,
			noChange: !preview && statements.length === 0
		};
	}
	let affected = 0;
	let insertId: number | null = null;
	const warnings: string[] = [];
	const multi = statements.length > 1;
	if (multi) await conn.query('START TRANSACTION');
	try {
		for (const st of statements) {
			const [header] = await conn.execute(st.sql, st.params as never[]);
			const h = header as { affectedRows?: number; insertId?: number };
			affected += h.affectedRows ?? 0;
			if (h.insertId) {
				insertId = Number(h.insertId) + Math.max((h.affectedRows ?? 1) - 1, 0);
			}
			const w = await query(conn, 'SHOW WARNINGS');
			for (const x of w) warnings.push(`${s(x.Level)} ${s(x.Code)}: ${s(x.Message)}`);
		}
		if (multi) await conn.query('COMMIT');
	} catch (e) {
		if (multi) await conn.query('ROLLBACK').catch(() => {});
		throw Object.assign(e as Error, { statements: rendered });
	}
	return {
		statements: rendered,
		affectedRows: affected,
		insertId,
		warnings,
		executed: true,
		noChange: false
	};
}
