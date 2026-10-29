/**
 * SQL export plugin, a port of libraries/classes/Plugins/Export/ExportSql.php.
 *
 * Option names are the phpMyAdmin option names without the `sql_` prefix. Differences with the
 * original (documented in docs/export.md-style notes in the final report): no alias renaming, no
 * pmadb metadata/relation/mime comments, no MSSQL compatibility rewrite, routine/trigger/event
 * bodies come straight from SHOW CREATE (no parser re-build) and view bodies only get their clause
 * keywords upper-cased.
 */
import { N_ } from '#lib/i18n/translator.ts';
import type {
	ExportContext,
	ExportData,
	ExportOption,
	ExportPlugin,
	ExportTableRef
} from '../types.ts';
import { strftime } from '../filename.ts';
import {
	alterAutoIncrement,
	alterConstraints,
	alterIndexes,
	backquote,
	createInsertBatcher,
	formatValue,
	formatViewDefinition,
	splitCreateTable
} from './sql-ddl.ts';

const COMPATIBILITIES = [
	'NONE',
	'ANSI',
	'DB2',
	'MAXDB',
	'MYSQL323',
	'MYSQL40',
	'ORACLE',
	'TRADITIONAL'
];

const GENERAL = 'general';
const STRUCTURE = 'structure';
const DATA = 'data';

const bool = (name: string, label: string, def: boolean, group: string): ExportOption => ({
	kind: 'bool',
	name,
	label,
	default: def,
	group
});

export const sqlOptions: ExportOption[] = [
	bool(
		'include_comments',
		N_('Display comments (includes info such as export timestamp, server version)'),
		true,
		GENERAL
	),
	{
		kind: 'text',
		name: 'header_comment',
		label: N_('Additional custom header comment (\\n splits lines)'),
		default: '',
		group: GENERAL
	},
	bool(
		'dates',
		N_('Include a timestamp of when databases were created, last updated, and last checked'),
		false,
		GENERAL
	),
	bool('use_transaction', N_('Enclose export in a transaction'), true, GENERAL),
	bool('disable_fk', N_('Disable foreign key checks'), false, GENERAL),
	bool('views_as_tables', N_('Export views as tables'), false, GENERAL),
	{
		kind: 'select',
		name: 'compatibility',
		label: N_('Database system or older MySQL server to maximize output compatibility with'),
		default: 'NONE',
		choices: COMPATIBILITIES.map((v) => ({ value: v, label: v })),
		group: GENERAL
	},
	bool('drop_database', N_('Add DROP DATABASE IF EXISTS statement'), false, STRUCTURE),
	bool('create_database', N_('Add CREATE DATABASE / USE statement'), false, STRUCTURE),
	bool(
		'drop_table',
		N_('Add DROP TABLE / VIEW / PROCEDURE / FUNCTION / EVENT / TRIGGER statement'),
		false,
		STRUCTURE
	),
	bool('create_table', N_('Add CREATE TABLE statement'), true, STRUCTURE),
	bool(
		'if_not_exists',
		N_('IF NOT EXISTS (less efficient as indexes will be generated during table creation)'),
		false,
		STRUCTURE
	),
	bool('auto_increment', N_('AUTO_INCREMENT value'), true, STRUCTURE),
	bool('create_view', N_('Add CREATE VIEW statement'), true, STRUCTURE),
	bool('simple_view_export', N_('Use simple view export'), false, STRUCTURE),
	bool('view_current_user', N_('Exclude definition of current user'), false, STRUCTURE),
	bool('or_replace_view', N_('OR REPLACE view'), false, STRUCTURE),
	bool(
		'procedure_function',
		N_('Add CREATE PROCEDURE / FUNCTION / EVENT statement'),
		true,
		STRUCTURE
	),
	bool('create_trigger', N_('Add CREATE TRIGGER statement'), true, STRUCTURE),
	bool(
		'backquotes',
		N_(
			'Enclose table and column names with backquotes (protects names with special characters or keywords)'
		),
		true,
		STRUCTURE
	),
	bool('truncate', N_('Truncate table before insert'), false, DATA),
	bool('delayed', N_('INSERT DELAYED statements'), false, DATA),
	bool('ignore', N_('INSERT IGNORE statements'), false, DATA),
	{
		kind: 'select',
		name: 'type',
		label: N_('Function to use when dumping data'),
		default: 'INSERT',
		choices: ['INSERT', 'UPDATE', 'REPLACE'].map((v) => ({ value: v, label: v })),
		group: DATA
	},
	{
		kind: 'radio',
		name: 'insert_syntax',
		label: N_('Syntax to use when inserting data'),
		default: 'both',
		choices: [
			{
				value: 'complete',
				label: N_(
					'include column names in every INSERT statement: INSERT INTO tbl_name (col_A,col_B,col_C) VALUES (1,2,3)'
				)
			},
			{
				value: 'extended',
				label: N_(
					'insert multiple rows in every INSERT statement: INSERT INTO tbl_name VALUES (1,2,3), (4,5,6), (7,8,9)'
				)
			},
			{
				value: 'both',
				label: N_(
					'both of the above: INSERT INTO tbl_name (col_A,col_B,col_C) VALUES (1,2,3), (4,5,6), (7,8,9)'
				)
			},
			{
				value: 'none',
				label: N_('neither of the above: INSERT INTO tbl_name VALUES (1,2,3)')
			}
		],
		group: DATA
	},
	{
		kind: 'number',
		name: 'max_query_size',
		label: N_('Maximal length of created query'),
		default: 50000,
		group: DATA
	},
	bool(
		'hex_for_binary',
		N_('Dump binary columns in hexadecimal notation (for example, "abc" becomes 0x616263)'),
		true,
		DATA
	),
	bool(
		'utc_time',
		N_(
			'Dump TIMESTAMP columns in UTC (enables TIMESTAMP columns to be dumped and reloaded between servers in different time zones)'
		),
		true,
		DATA
	)
];

// ---- per-run state ----------------------------------------------------------------------------

interface RunState {
	sentCharset: boolean;
	oldTz: string | null;
	/** Collected for the whole database, flushed by dbFooter (like $sql_indexes & co). */
	indexes: string | null;
	autoIncrements: string | null;
	constraints: string | null;
	views: string;
	quoteShowCreateChanged: boolean;
}

const states = new WeakMap<ExportContext, RunState>();

function state(ctx: ExportContext): RunState {
	let s = states.get(ctx);
	if (!s) {
		s = {
			sentCharset: false,
			oldTz: null,
			indexes: null,
			autoIncrements: null,
			constraints: null,
			views: '',
			quoteShowCreateChanged: false
		};
		states.set(ctx, s);
	}
	return s;
}

const on = (ctx: ExportContext, name: string): boolean => ctx.options[name] === true;
const str = (ctx: ExportContext, name: string, def = ''): string => {
	const v = ctx.options[name];
	return v === undefined || v === null || v === false ? def : String(v);
};
const versionInt = (v: string): number => {
	const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
	return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 0;
};
const localised = (d: Date) => strftime('%B %d, %Y at %I:%M %p', d);

/** Statement that is allowed to fail (phpMyAdmin tryQuery). */
async function tryQuery(ctx: ExportContext, sql: string): Promise<void> {
	try {
		await ctx.conn.query(sql);
	} catch {
		// ignored on purpose
	}
}

/** `-- text` lines when comments are enabled (ExportSql::exportComment). */
function comment(ctx: ExportContext, text = ''): string {
	if (!on(ctx, 'include_comments')) return '';
	if (text === '') return '--' + ctx.crlf;
	return text
		.split(/\r\n|\r|\n/)
		.map((l) => '-- ' + l + ctx.crlf)
		.join('');
}
const possibleCrlf = (ctx: ExportContext) => (on(ctx, 'include_comments') ? ctx.crlf : '');
const bq = (ctx: ExportContext, id: string) => backquote(id, on(ctx, 'backquotes'));

type Row = Record<string, unknown>;
async function rows(ctx: ExportContext, sql: string): Promise<Row[]> {
	const [r] = await ctx.conn.query(sql);
	return r as Row[];
}

/** Comment block opening a collected section ("Indexes for dumped tables" once, then per table). */
function section(
	ctx: ExportContext,
	existing: string | null,
	general: string,
	perTable: string,
	table: string
): string {
	const { crlf } = ctx;
	let sql = existing;
	if (sql === null) sql = crlf + comment(ctx) + comment(ctx, general) + comment(ctx);
	return sql + crlf + comment(ctx) + comment(ctx, `${perTable} ${bq(ctx, table)}`) + comment(ctx);
}

// ---- hooks ------------------------------------------------------------------------------------

async function header(ctx: ExportContext): Promise<void> {
	const { crlf } = ctx;
	const compat = str(ctx, 'compatibility', 'NONE');
	if (ctx.options.compatibility !== undefined) {
		await tryQuery(ctx, `SET SQL_MODE="${compat === 'NONE' ? '' : compat}"`);
	}
	let head =
		comment(ctx, 'svelteMyAdmin SQL Dump') +
		comment(ctx, 'version ' + ctx.appVersion) +
		comment(ctx);
	head += comment(ctx, 'Host: ' + ctx.server.host);
	head +=
		comment(ctx, 'Generation Time: ' + localised(ctx.now)) +
		comment(ctx, 'Server version: ' + ctx.server.version) +
		comment(ctx, 'Node.js Version: ' + process.version) +
		possibleCrlf(ctx);

	const custom = str(ctx, 'header_comment');
	if (custom) {
		head += comment(ctx);
		for (const line of custom.split('\\n')) head += comment(ctx, line);
		head += comment(ctx);
	}
	if (on(ctx, 'disable_fk')) head += 'SET FOREIGN_KEY_CHECKS=0;' + crlf;
	if (compat === 'NONE') head += 'SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";' + crlf;
	if (on(ctx, 'use_transaction')) head += 'START TRANSACTION;' + crlf;

	const s = state(ctx);
	if (on(ctx, 'utc_time')) {
		head += 'SET time_zone = "+00:00";' + crlf;
		const [r] = await ctx.conn.query('SELECT @@session.time_zone AS tz');
		s.oldTz = String((r as Row[])[0]?.tz ?? 'SYSTEM');
		await ctx.conn.query('SET time_zone = "+00:00"');
	}
	head += possibleCrlf(ctx);

	if (ctx.asFile !== false) {
		let names = ctx.charset && ctx.charset !== 'utf-8' ? charsetNames(ctx.charset) : 'utf8';
		if (names === 'utf8' && versionInt(ctx.server.version) > 50503) names = 'utf8mb4';
		head +=
			crlf +
			'/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;' +
			crlf +
			'/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;' +
			crlf +
			'/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;' +
			crlf +
			`/*!40101 SET NAMES ${names} */;` +
			crlf +
			crlf;
		s.sentCharset = true;
	}
	await ctx.write(head);
}

const CHARSET_MAP: Record<string, string> = {
	'iso-8859-1': 'latin1',
	'iso-8859-2': 'latin2',
	'iso-8859-7': 'greek',
	'iso-8859-15': 'latin1',
	'windows-1250': 'cp1250',
	'windows-1251': 'cp1251',
	'windows-1252': 'latin1',
	'windows-1256': 'cp1256',
	'koi8-r': 'koi8r',
	shift_jis: 'sjis',
	'euc-jp': 'ujis',
	'euc-kr': 'euckr',
	gbk: 'gbk',
	gb2312: 'gb2312',
	big5: 'big5',
	'us-ascii': 'ascii'
};
const charsetNames = (c: string) => CHARSET_MAP[c] ?? 'utf8';

async function footer(ctx: ExportContext): Promise<void> {
	const { crlf } = ctx;
	const s = state(ctx);
	let foot = '';
	if (on(ctx, 'disable_fk')) foot += 'SET FOREIGN_KEY_CHECKS=1;' + crlf;
	if (on(ctx, 'use_transaction')) foot += 'COMMIT;' + crlf;
	if (s.sentCharset) {
		foot +=
			crlf +
			'/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;' +
			crlf +
			'/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;' +
			crlf +
			'/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;' +
			crlf;
		s.sentCharset = false;
	}
	if (s.oldTz !== null) {
		await tryQuery(ctx, `SET time_zone = "${s.oldTz.replaceAll('"', '')}"`);
		s.oldTz = null;
	}
	if (s.quoteShowCreateChanged) await tryQuery(ctx, 'SET SQL_QUOTE_SHOW_CREATE = 1');
	await ctx.write(foot);
}

async function dbHeader(ctx: ExportContext, db: string, alias?: string): Promise<void> {
	const name = alias || db;
	await ctx.write(comment(ctx) + comment(ctx, 'Database: ' + bq(ctx, name)) + comment(ctx));
}

async function dbCreate(ctx: ExportContext, db: string, alias?: string): Promise<void> {
	const { crlf } = ctx;
	const name = alias || db;
	const sod = ctx.structureOrData ?? 'structure_and_data';
	const exportStructure = sod === 'structure' || sod === 'structure_and_data';
	if (exportStructure && on(ctx, 'drop_database')) {
		await ctx.write(`DROP DATABASE IF EXISTS ${bq(ctx, name)};${crlf}`);
	}
	if (ctx.scope === 'database' && !on(ctx, 'create_database')) return;

	let q = 'CREATE DATABASE IF NOT EXISTS ' + bq(ctx, name);
	const r = await rows(
		ctx,
		`SELECT DEFAULT_CHARACTER_SET_NAME AS cs, DEFAULT_COLLATION_NAME AS coll FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = '${db.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
	);
	const coll = String(r[0]?.coll ?? '');
	if (coll.includes('_'))
		q += ` DEFAULT CHARACTER SET ${coll.slice(0, coll.indexOf('_'))} COLLATE ${coll}`;
	else if (coll) q += ` DEFAULT CHARACTER SET ${coll}`;
	await ctx.write(q + ';' + crlf);
	const compat = str(ctx, 'compatibility', 'NONE');
	await ctx.write(`USE ${compat === 'NONE' ? bq(ctx, name) : name};${crlf}`);
}

async function showCreate(
	ctx: ExportContext,
	kind: 'TABLE' | 'PROCEDURE' | 'FUNCTION' | 'EVENT',
	db: string,
	name: string
): Promise<string | null> {
	const [r] = await ctx.conn.query(
		`SHOW CREATE ${kind} \`${db.replaceAll('`', '``')}\`.\`${name.replaceAll('`', '``')}\``
	);
	const row = (r as Row[])[0];
	if (!row) return null;
	const key = Object.keys(row).find((k) => /^Create /i.test(k));
	const v = key ? row[key] : Object.values(row)[1];
	return typeof v === 'string' ? v : null;
}

/** Normalise line endings of a SHOW CREATE text to `crlf` (only when it is a multi-line definition). */
function fixEol(create: string, crlf: string): string {
	if (create.includes('(\r\n ')) return create.replaceAll('\r\n', crlf);
	if (create.includes('(\n ')) return create.replaceAll('\n', crlf);
	if (create.includes('(\r ')) return create.replaceAll('\r', crlf);
	return create;
}

async function tableDates(
	ctx: ExportContext,
	db: string,
	table: string
): Promise<{ text: string; crlf: string }> {
	const { crlf } = ctx;
	if (!on(ctx, 'dates')) return { text: '', crlf };
	let text = '';
	let newCrlf = crlf;
	try {
		const r = await rows(
			ctx,
			`SHOW TABLE STATUS FROM ${backquote(db)} WHERE Name = '${table.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`
		);
		const t = r[0];
		for (const [col, label] of [
			['Create_time', 'Creation:'],
			['Update_time', 'Last update:'],
			['Check_time', 'Last check:']
		] as const) {
			const v = t?.[col];
			if (v) {
				text += comment(ctx, `${label} ${localised(new Date(String(v).replace(' ', 'T')))}`);
				newCrlf = comment(ctx) + crlf;
			}
		}
	} catch {
		// no dates
	}
	return { text, crlf: newCrlf };
}

/** getTableDef(): CREATE TABLE / CREATE VIEW text, collecting indexes/auto-increment/constraints. */
async function tableDef(ctx: ExportContext, ref: ExportTableRef, isView: boolean): Promise<string> {
	const { crlf } = ctx;
	const s = state(ctx);
	const table = ref.alias || ref.table;
	const dates = await tableDates(ctx, ref.db, ref.table);
	let out = dates.text + dates.crlf;

	if (on(ctx, 'drop_table')) {
		out += `DROP ${isView ? 'VIEW' : 'TABLE'} IF EXISTS ${backquote(table, on(ctx, 'backquotes'))};${crlf}`;
	}
	await ctx.conn.query(`SET SQL_QUOTE_SHOW_CREATE = ${on(ctx, 'backquotes') ? 1 : 0}`);
	s.quoteShowCreateChanged = true;
	let create: string | null;
	try {
		create = await showCreate(ctx, 'TABLE', ref.db, ref.table);
	} catch (e) {
		return comment(
			ctx,
			`Error reading structure for table ${ref.db}.${ref.table}: ${(e as Error).message}`
		);
	}
	if (create === null) return out;
	create = fixEol(create, crlf);

	if (isView) {
		create = formatViewDefinition(create, {
			db: ref.db,
			removeDefiner: on(ctx, 'view_current_user'),
			simple: on(ctx, 'simple_view_export'),
			orReplace: on(ctx, 'or_replace_view')
		});
		return out + create + ';' + crlf;
	}

	const ifNotExists = on(ctx, 'if_not_exists');
	if (ifNotExists) create = create.replace(/^CREATE TABLE/, 'CREATE TABLE IF NOT EXISTS');
	const parts = splitCreateTable(create, { ifNotExists });
	const compat = str(ctx, 'compatibility', 'NONE');
	const tname = backquote(table, on(ctx, 'backquotes'));
	void compat;

	if (parts.constraints.length) {
		s.constraints =
			section(ctx, s.constraints, 'Constraints for dumped tables', 'Constraints for table', table) +
			alterConstraints(tname, parts, crlf);
	}
	const idx = alterIndexes(tname, parts, crlf);
	if (idx) {
		s.indexes =
			section(ctx, s.indexes, 'Indexes for dumped tables', 'Indexes for table', table) + idx;
	}
	if (parts.autoIncrement.length) {
		const withValue =
			on(ctx, 'auto_increment') && (ctx.dataTables === undefined || ctx.dataTables.has(ref.table));
		s.autoIncrements =
			section(
				ctx,
				s.autoIncrements,
				'AUTO_INCREMENT for dumped tables',
				'AUTO_INCREMENT for table',
				table
			) + alterAutoIncrement(tname, parts, crlf, withValue);
	}
	const createText = parts.create;
	if (ifNotExists && on(ctx, 'auto_increment')) {
		// kept as is
	}
	return out + createText + ';' + crlf;
}

async function standInDef(ctx: ExportContext, ref: ExportTableRef): Promise<string> {
	const { crlf } = ctx;
	const name = ref.alias || ref.table;
	let q = '';
	if (on(ctx, 'drop_table')) q += `DROP VIEW IF EXISTS ${backquote(name)};${crlf}`;
	q +=
		'CREATE TABLE ' +
		(on(ctx, 'if_not_exists') ? 'IF NOT EXISTS ' : '') +
		backquote(name) +
		' (' +
		crlf;
	const cols = await rows(
		ctx,
		`SHOW FULL COLUMNS FROM ${backquote(ref.db)}.${backquote(ref.table)}`
	);
	const tmp = cols.map((c) => backquote(String(c.Field)) + ' ' + String(c.Type) + crlf);
	return q + tmp.join(',') + ');' + crlf;
}

/** Column list of a view exported as a table (getTableDefForView). */
async function viewAsTableDef(ctx: ExportContext, ref: ExportTableRef): Promise<string> {
	const { crlf } = ctx;
	const name = ref.alias || ref.table;
	const q =
		'CREATE TABLE' +
		(on(ctx, 'if_not_exists') ? ' IF NOT EXISTS ' : '') +
		backquote(name) +
		'(' +
		crlf;
	const cols = await rows(
		ctx,
		`SHOW FULL COLUMNS FROM ${backquote(ref.db)}.${backquote(ref.table)}`
	);
	const parts = cols.map((c) => {
		let l = '    ' + backquote(String(c.Field)) + ' ' + String(c.Type);
		if (c.Collation && /char|text|enum|set/i.test(String(c.Type))) l += ' COLLATE ' + c.Collation;
		if (c.Null === 'NO') l += ' NOT NULL';
		if (c.Default !== null && c.Default !== undefined) {
			l += ` DEFAULT '${String(c.Default).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
		} else if (c.Null === 'YES') l += ' DEFAULT NULL';
		if (c.Comment)
			l += ` COMMENT '${String(c.Comment).replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
		return l;
	});
	return q + parts.join(',' + crlf) + crlf + ');' + crlf;
}

async function structure(ctx: ExportContext, ref: ExportTableRef): Promise<void> {
	const { crlf } = ctx;
	const name = ref.alias || ref.table;
	const formatted = bq(ctx, name);
	const sep = () =>
		possibleCrlf(ctx) + comment(ctx, '-'.repeat(56)) + possibleCrlf(ctx) + comment(ctx);

	if (ref.kind === 'view') {
		if (!on(ctx, 'create_view')) return;
		if (ctx.scope === 'table') {
			// single view: only its CREATE VIEW (deferred to dbFooter like phpMyAdmin)
			await createView(ctx, ref);
			return;
		}
		await ctx.write(
			sep() +
				comment(ctx, 'Stand-in structure for view ' + formatted) +
				comment(ctx, '(See below for the actual view)') +
				comment(ctx) +
				(await standInDef(ctx, ref))
		);
		return;
	}
	if (!on(ctx, 'create_table')) return;
	await ctx.write(
		sep() +
			comment(ctx, 'Table structure for table ' + formatted) +
			comment(ctx) +
			(await tableDef(ctx, ref, false))
	);
	void crlf;
}

async function createView(ctx: ExportContext, ref: ExportTableRef): Promise<void> {
	const { crlf } = ctx;
	const s = state(ctx);
	const name = ref.alias || ref.table;
	const formatted = bq(ctx, name);
	let dump = possibleCrlf(ctx) + comment(ctx, '-'.repeat(56)) + possibleCrlf(ctx) + comment(ctx);
	if (!on(ctx, 'views_as_tables')) {
		dump += comment(ctx, 'Structure for view ' + formatted) + comment(ctx);
		if (ctx.scope !== 'table') dump += `DROP TABLE IF EXISTS ${backquote(name)};${crlf}`;
		dump += await tableDef(ctx, ref, true);
		s.views += dump;
		return;
	}
	dump += comment(ctx, `Structure for view ${formatted} exported as a table`) + comment(ctx);
	if (ctx.scope !== 'table') dump += `DROP TABLE IF EXISTS ${backquote(name)};${crlf}`;
	dump += await viewAsTableDef(ctx, ref);
	await ctx.write(dump);
}

async function dbAfterTables(
	ctx: ExportContext,
	_db: string,
	tables: ExportTableRef[]
): Promise<void> {
	if (ctx.scope === 'table' || !on(ctx, 'create_view')) return;
	for (const ref of tables) if (ref.kind === 'view') await createView(ctx, ref);
}

async function dbFooter(ctx: ExportContext): Promise<void> {
	const s = state(ctx);
	let out = '';
	if (s.indexes !== null) out += s.indexes;
	if (s.autoIncrements !== null) out += s.autoIncrements;
	if (s.views !== '') out += s.views;
	if (s.constraints !== null) out += s.constraints;
	s.indexes = s.autoIncrements = s.constraints = null;
	s.views = '';
	if (out) await ctx.write(out);
}

async function uniqueCondition(
	ctx: ExportContext,
	ref: ExportTableRef,
	names: string[],
	values: string[]
): Promise<string> {
	let keyCols: string[] = [];
	if (ref.table) {
		try {
			const cols = await rows(
				ctx,
				`SHOW COLUMNS FROM ${backquote(ref.db)}.${backquote(ref.table)}`
			);
			keyCols = cols.filter((c) => c.Key === 'PRI').map((c) => String(c.Field));
			if (!keyCols.length)
				keyCols = cols.filter((c) => c.Key === 'UNI').map((c) => String(c.Field));
		} catch {
			// all columns
		}
	}
	const use = names
		.map((n, i) => ({ n, v: values[i] }))
		.filter((x) => !keyCols.length || keyCols.includes(x.n));
	return use
		.map((x) => `${backquote(x.n)} ${x.v === 'NULL' ? 'IS NULL' : '= ' + x.v}`)
		.join(' AND ');
}

async function data(ctx: ExportContext, d: ExportData): Promise<void> {
	const { crlf } = ctx;
	const { ref, fields } = d;
	const name = ref.alias || ref.table;
	const formatted = bq(ctx, name);

	if (ref.kind === 'view' && !on(ctx, 'views_as_tables')) {
		await ctx.write(
			possibleCrlf(ctx) +
				comment(ctx) +
				comment(ctx, 'VIEW ' + formatted) +
				comment(ctx, 'Data: None') +
				comment(ctx) +
				possibleCrlf(ctx)
		);
		return;
	}

	const type = str(ctx, 'type', 'INSERT') as 'INSERT' | 'UPDATE' | 'REPLACE';
	const syntax = str(ctx, 'insert_syntax', 'both') as 'complete' | 'extended' | 'both' | 'none';
	const columns = fields.map((f) => backquote(f.name, on(ctx, 'backquotes')));

	if (type === 'INSERT' && on(ctx, 'truncate')) {
		await ctx.write(
			possibleCrlf(ctx) +
				comment(ctx) +
				comment(ctx, 'Truncate table before insert ' + formatted) +
				comment(ctx) +
				crlf
		);
		await ctx.write(`TRUNCATE TABLE ${formatted};`);
	}

	const batcher = createInsertBatcher({
		command: type,
		table: formatted,
		columns,
		delayed: on(ctx, 'delayed'),
		ignore: on(ctx, 'ignore'),
		syntax,
		maxQuerySize: Number(ctx.options.max_query_size ?? 50000),
		crlf
	});
	const hex = on(ctx, 'hex_for_binary');
	let chunk = '';
	let first = true;
	for await (const row of d.rows) {
		if (first) {
			first = false;
			await ctx.write(
				possibleCrlf(ctx) +
					comment(ctx) +
					comment(ctx, 'Dumping data for table ' + formatted) +
					comment(ctx) +
					crlf
			);
		}
		const values = fields.map((f, j) => formatValue(row[j], f, { hexForBinary: hex }));
		let update: string | undefined;
		if (type === 'UPDATE') {
			update =
				' ' +
				columns.map((c, i) => `${c} = ${values[i]}`).join(',') +
				' WHERE ' +
				(await uniqueCondition(
					ctx,
					ref,
					fields.map((f) => f.name),
					values
				));
		}
		chunk += batcher.next(values, update);
		if (chunk.length > 32 * 1024) {
			await ctx.write(chunk);
			chunk = '';
		}
	}
	chunk += batcher.finish();
	if (chunk) await ctx.write(chunk);
}

async function routines(ctx: ExportContext, db: string): Promise<void> {
	if (!on(ctx, 'procedure_function')) return;
	const { crlf } = ctx;
	const delimiter = '$$';
	const list = async (kind: 'PROCEDURE' | 'FUNCTION') => {
		const r = await rows(ctx, `SHOW ${kind} STATUS`);
		return r.filter((x) => x.Db === db && x.Type === kind).map((x) => String(x.Name));
	};
	const procs = await list('PROCEDURE');
	const funcs = await list('FUNCTION');
	if (!procs.length && !funcs.length) return;

	const block = async (kind: 'PROCEDURE' | 'FUNCTION', title: string, names: string[]) => {
		let text = comment(ctx) + comment(ctx, title) + comment(ctx);
		for (const n of names) {
			if (on(ctx, 'drop_table'))
				text += `DROP ${kind} IF EXISTS ${backquote(n)}${delimiter}${crlf}`;
			const create = (await showCreate(ctx, kind, db, n)) ?? '';
			text += create + delimiter + crlf + crlf;
		}
		return text;
	};
	let text = crlf + 'DELIMITER ' + delimiter + crlf;
	if (procs.length) text += await block('PROCEDURE', 'Procedures', procs);
	if (funcs.length) text += await block('FUNCTION', 'Functions', funcs);
	text += 'DELIMITER ;' + crlf;
	await ctx.write(text);
}

async function events(ctx: ExportContext, db: string): Promise<void> {
	if (!on(ctx, 'procedure_function')) return;
	const { crlf } = ctx;
	const delimiter = '$$';
	const [names] = await ctx.conn.query(
		'SELECT EVENT_NAME AS name FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ? ORDER BY EVENT_NAME',
		[db]
	);
	const list = (names as Row[]).map((r) => String(r.name));
	if (!list.length) return;
	let text = crlf + 'DELIMITER ' + delimiter + crlf;
	text += comment(ctx) + comment(ctx, 'Events') + comment(ctx);
	for (const n of list) {
		if (on(ctx, 'drop_table')) text += `DROP EVENT IF EXISTS ${backquote(n)}${delimiter}${crlf}`;
		const def = (await showCreate(ctx, 'EVENT', db, n)) ?? '';
		text += def + delimiter + crlf + crlf;
	}
	text += 'DELIMITER ;' + crlf;
	await ctx.write(text);
}

async function triggers(ctx: ExportContext, ref: ExportTableRef): Promise<void> {
	if (!on(ctx, 'create_trigger') || ref.kind === 'view') return;
	const { crlf } = ctx;
	const delimiter = '$$';
	const [r] = await ctx.conn.query(
		'SELECT TRIGGER_NAME AS name, ACTION_TIMING AS timing, EVENT_MANIPULATION AS event, ' +
			'EVENT_OBJECT_TABLE AS tbl, ACTION_STATEMENT AS stmt FROM information_schema.TRIGGERS ' +
			'WHERE TRIGGER_SCHEMA = ? AND EVENT_OBJECT_TABLE = ? ORDER BY TRIGGER_NAME',
		[ref.db, ref.table]
	);
	const list = r as Row[];
	if (!list.length) return;
	let dump =
		possibleCrlf(ctx) +
		comment(ctx) +
		comment(ctx, 'Triggers ' + bq(ctx, ref.alias || ref.table)) +
		comment(ctx);
	for (const t of list) {
		const name = backquote(String(t.name));
		if (on(ctx, 'drop_table')) dump += `DROP TRIGGER IF EXISTS ${name};${crlf}`;
		dump += 'DELIMITER ' + delimiter + crlf;
		dump += `CREATE TRIGGER ${name} ${t.timing} ${t.event} ON ${backquote(String(t.tbl))} FOR EACH ROW ${t.stmt}${crlf}`;
		dump += delimiter + crlf + 'DELIMITER ;' + crlf;
	}
	await ctx.write(dump);
}

const plugin: ExportPlugin = {
	id: 'sql',
	label: N_('SQL'),
	extension: 'sql',
	mimeType: 'text/x-sql',
	scopes: ['server', 'database', 'table', 'raw'],
	supports: { structure: true, data: true },
	options: sqlOptions,
	header,
	footer,
	dbHeader,
	dbCreate,
	structure,
	data,
	routines,
	events,
	triggers,
	dbAfterTables,
	dbFooter
};

export default plugin;
