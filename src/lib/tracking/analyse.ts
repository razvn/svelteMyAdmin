/**
 * Lightweight statement analyser for the change tracker (Tracker::parseQuery without a SQL parser)
 * plus the tracking log format helpers (Tracker::getTrackedData, Tracking::filter).
 */

export type TrackingType = 'DDL' | 'DML';

export const TRACKING_STATEMENTS = [
	'UPDATE',
	'REPLACE',
	'INSERT',
	'DELETE',
	'TRUNCATE',
	'CREATE DATABASE',
	'ALTER DATABASE',
	'DROP DATABASE',
	'CREATE TABLE',
	'ALTER TABLE',
	'RENAME TABLE',
	'DROP TABLE',
	'CREATE INDEX',
	'DROP INDEX',
	'CREATE VIEW',
	'ALTER VIEW',
	'DROP VIEW'
] as const;
export type TrackingStatement = (typeof TRACKING_STATEMENTS)[number];

export interface Analysis {
	type: TrackingType;
	identifier: TrackingStatement;
	/** Database named in the statement (undefined = the current database). */
	db?: string;
	/** '' for the database level statements. */
	table: string;
	tableAfterRename?: string;
}

const PART = '(?:`(?:[^`]|``)+`|[A-Za-z0-9_$\\u0080-\\uFFFF]+)';
const IDENT = `(${PART})(?:\\s*\\.\\s*(${PART}))?`;
const IF_NOT = '(?:IF\\s+NOT\\s+EXISTS\\s+)?';
const IF_EX = '(?:IF\\s+EXISTS\\s+)?';

const unquote = (s: string): string =>
	s.startsWith('`') ? s.slice(1, -1).replaceAll('``', '`') : s;

/** Leading whitespace and comments removed (a `/*!...*\/` version comment is kept). */
export function stripLeadingComments(sql: string): string {
	let s = sql;
	for (;;) {
		const t = s.replace(/^\s+/, '');
		if (t.startsWith('--') || t.startsWith('#')) {
			const nl = t.indexOf('\n');
			s = nl < 0 ? '' : t.slice(nl + 1);
		} else if (t.startsWith('/*') && !t.startsWith('/*!') && !t.startsWith('/*+')) {
			const end = t.indexOf('*/');
			s = end < 0 ? '' : t.slice(end + 2);
		} else return t;
	}
}

function ident(m: RegExpExecArray, i: number): { db?: string; table: string } {
	const a = unquote(m[i]);
	const b = m[i + 1];
	return b === undefined ? { table: a } : { db: a, table: unquote(b) };
}

const re = (source: string) => new RegExp(source, 'i');

const CREATE_TABLE = re(`^CREATE\\s+(?:TEMPORARY\\s+)?TABLE\\s+${IF_NOT}${IDENT}`);
const CREATE_DB = re(`^CREATE\\s+(?:DATABASE|SCHEMA)\\s+${IF_NOT}(${PART})`);
const CREATE_VIEW = re(
	'^CREATE\\s+(?:OR\\s+REPLACE\\s+)?(?:ALGORITHM\\s*=\\s*\\w+\\s+)?' +
		"(?:DEFINER\\s*=\\s*(?:`[^`]*`|'[^']*'|[^\\s@]+)(?:@(?:`[^`]*`|'[^']*'|\\S+))?\\s+)?" +
		`(?:SQL\\s+SECURITY\\s+\\w+\\s+)?VIEW\\s+${IDENT}`
);
const CREATE_INDEX = re(
	`^CREATE\\s+(?:UNIQUE\\s+|FULLTEXT\\s+|SPATIAL\\s+)?INDEX\\s+${PART}(?:\\s+USING\\s+\\w+)?\\s+ON\\s+${IDENT}`
);
const ALTER_TABLE = re(`^ALTER\\s+(?:ONLINE\\s+|IGNORE\\s+)*TABLE\\s+${IDENT}`);
const ALTER_DB = re(`^ALTER\\s+(?:DATABASE|SCHEMA)\\s+(${PART})`);
const ALTER_VIEW = re(
	`^ALTER\\s+(?:ALGORITHM\\s*=\\s*\\w+\\s+)?(?:DEFINER\\s*=\\s*\\S+\\s+)?(?:SQL\\s+SECURITY\\s+\\w+\\s+)?VIEW\\s+${IDENT}`
);
const DROP_TV = re(`^DROP\\s+(?:TEMPORARY\\s+)?(TABLE|VIEW)\\s+${IF_EX}${IDENT}`);
const DROP_DB = re(`^DROP\\s+(?:DATABASE|SCHEMA)\\s+${IF_EX}(${PART})`);
const DROP_INDEX = re(`^DROP\\s+INDEX\\s+${PART}\\s+ON\\s+${IDENT}`);
const RENAME = re(`^RENAME\\s+TABLE\\s+${IDENT}\\s+TO\\s+${IDENT}`);
const UPDATE = re(`^UPDATE\\s+(?:LOW_PRIORITY\\s+|IGNORE\\s+)*${IDENT}`);
const INSERT = re(
	`^INSERT\\s+(?:LOW_PRIORITY\\s+|DELAYED\\s+|HIGH_PRIORITY\\s+|IGNORE\\s+)*(?:INTO\\s+)?${IDENT}`
);
const REPLACE = re(`^REPLACE\\s+(?:LOW_PRIORITY\\s+|DELAYED\\s+)*(?:INTO\\s+)?${IDENT}`);
const DELETE = re(`^DELETE\\s+(?:LOW_PRIORITY\\s+|QUICK\\s+|IGNORE\\s+)*FROM\\s+${IDENT}`);
const TRUNCATE = re(`^TRUNCATE\\s+(?:TABLE\\s+)?${IDENT}`);

/** What does `sql` do to which table? null when it is not a trackable statement. */
export function analyseStatement(sql: string): Analysis | null {
	const s = stripLeadingComments(sql);
	const ddl = (identifier: TrackingStatement, m: RegExpExecArray, i: number): Analysis => ({
		type: 'DDL',
		identifier,
		...ident(m, i)
	});
	const dml = (identifier: TrackingStatement, m: RegExpExecArray, i: number): Analysis => ({
		type: 'DML',
		identifier,
		...ident(m, i)
	});
	const database = (identifier: TrackingStatement, m: RegExpExecArray): Analysis => ({
		type: 'DDL',
		identifier,
		db: unquote(m[1]),
		table: ''
	});
	let m: RegExpExecArray | null;

	if (/^CREATE\s/i.test(s)) {
		if ((m = CREATE_TABLE.exec(s))) return ddl('CREATE TABLE', m, 1);
		if ((m = CREATE_DB.exec(s))) return database('CREATE DATABASE', m);
		if ((m = CREATE_VIEW.exec(s))) return ddl('CREATE VIEW', m, 1);
		if ((m = CREATE_INDEX.exec(s))) return ddl('CREATE INDEX', m, 1);
		return null;
	}
	if (/^ALTER\s/i.test(s)) {
		if ((m = ALTER_TABLE.exec(s))) return ddl('ALTER TABLE', m, 1);
		if ((m = ALTER_DB.exec(s))) return database('ALTER DATABASE', m);
		if ((m = ALTER_VIEW.exec(s))) return ddl('ALTER VIEW', m, 1);
		return null;
	}
	if (/^DROP\s/i.test(s)) {
		if ((m = DROP_TV.exec(s))) return ddl(`DROP ${m[1].toUpperCase()}` as TrackingStatement, m, 2);
		if ((m = DROP_DB.exec(s))) return database('DROP DATABASE', m);
		if ((m = DROP_INDEX.exec(s))) return ddl('DROP INDEX', m, 1);
		return null;
	}
	if ((m = RENAME.exec(s))) {
		return {
			type: 'DDL',
			identifier: 'RENAME TABLE',
			...ident(m, 1),
			tableAfterRename: ident(m, 3).table
		};
	}
	if ((m = UPDATE.exec(s))) return dml('UPDATE', m, 1);
	if ((m = INSERT.exec(s))) return dml('INSERT', m, 1);
	if ((m = REPLACE.exec(s))) return dml('REPLACE', m, 1);
	if ((m = DELETE.exec(s))) return dml('DELETE', m, 1);
	if ((m = TRUNCATE.exec(s))) return dml('TRUNCATE', m, 1);
	return null;
}

/** `USE db` => the database name. */
export function parseUse(sql: string): string | null {
	const m = re(`^USE\\s+(${PART})\\s*;?\\s*$`).exec(stripLeadingComments(sql));
	return m ? unquote(m[1]) : null;
}

export const isNoTrack = (sql: string): boolean => sql.includes('/*NOTRACK*/');

// ---- log format ---------------------------------------------------------------------------------

export interface LogEntry {
	date: string;
	username: string;
	statement: string;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `Y-m-d H:i:s` in local time (Util::date). */
export function formatDate(d: Date = new Date()): string {
	return (
		`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
		`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
	);
}

/** Tracker::getLogComment. */
export const logComment = (date: string, user: string): string =>
	`# log ${date} ${user.replace(/\s+/g, ' ')}\n`;

/**
 * The chunk appended to schema_sql / data_sql for one statement (Tracker::handleQuery): log comment,
 * the statement terminated by `;`, `` `db`. `` prefixes removed.
 */
export function logChunk(date: string, user: string, sql: string, db: string): string {
	let q = sql.endsWith(';') ? sql : `${sql};\n`;
	q = q.replace(new RegExp('`' + db.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`\\s?\\.', 'g'), '');
	return logComment(date, user) + q;
}

/** Parse a schema_sql / data_sql blob (Tracker::getTrackedData). */
export function parseLog(text: string | null): LogEntry[] {
	const out: LogEntry[] = [];
	for (const chunk of (text ?? '').split('# log ')) {
		if (chunk.trim() === '') continue;
		const nl = chunk.indexOf('\n');
		out.push({
			date: chunk.slice(0, 19),
			username: chunk.slice(20, nl < 0 ? undefined : nl),
			statement: (nl < 0 ? '' : chunk.slice(nl + 1)).trimEnd()
		});
	}
	return out;
}

/** Inverse of parseLog, as written back after deleting an entry. */
export function serializeLog(entries: LogEntry[]): string {
	return entries.map((e) => `# log ${e.date} ${e.username}\n${e.statement}\n`).join('');
}

export interface ReportFilter {
	/** Inclusive bounds, `Y-m-d H:i:s`; '' = open. */
	from?: string;
	to?: string;
	/** Comma separated; '*' or empty = every user. */
	users?: string;
}

export interface FilteredEntry extends LogEntry {
	/** Index in the unfiltered log (used to delete the row). */
	id: number;
}

const ts = (s: string): number => new Date(s.replace(' ', 'T')).getTime();

/** Tracking::filter. */
export function filterEntries(entries: LogEntry[], f: ReportFilter): FilteredEntry[] {
	const from = f.from ? ts(f.from) : -Infinity;
	const to = f.to ? ts(f.to) : Infinity;
	const users = (f.users ?? '*')
		.split(',')
		.map((u) => u.trim())
		.filter(Boolean);
	const all = users.length === 0 || users.includes('*');
	const out: FilteredEntry[] = [];
	entries.forEach((e, id) => {
		const t = ts(e.date);
		if (t >= from && t <= to && (all || users.includes(e.username))) out.push({ ...e, id });
	});
	return out;
}

/** Statement list as SQL text (Tracking::exportAsSqlDump / exportAsFileDownload). */
export const entriesToSql = (entries: { statement: string }[]): string =>
	entries.map((e) => e.statement).join('\n');

// ---- PHP serialize (schema_snapshot compatibility) --------------------------------------------

export type PhpValue = null | boolean | number | string | PhpValue[] | { [k: string]: PhpValue };

export function phpSerialize(v: PhpValue): string {
	if (v === null) return 'N;';
	if (typeof v === 'boolean') return `b:${v ? 1 : 0};`;
	if (typeof v === 'number') return Number.isInteger(v) ? `i:${v};` : `d:${v};`;
	if (typeof v === 'string') return `s:${Buffer.byteLength(v)}:"${v}";`;
	const entries: [string | number, PhpValue][] = Array.isArray(v)
		? v.map((x, i) => [i, x])
		: Object.entries(v);
	let body = '';
	for (const [k, x] of entries) body += phpSerialize(k) + phpSerialize(x);
	return `a:${entries.length}:{${body}}`;
}

/** Minimal unserialize (arrays, strings, ints, floats, bools, null); undefined on malformed input. */
export function phpUnserialize(text: string | null): PhpValue | undefined {
	if (!text) return undefined;
	const buf = Buffer.from(text, 'utf8');
	let pos = 0;
	const readUntil = (ch: string): string => {
		const end = buf.indexOf(ch, pos);
		if (end < 0) throw new Error('bad');
		const s = buf.toString('utf8', pos, end);
		pos = end + 1;
		return s;
	};
	const parse = (): PhpValue => {
		const t = String.fromCharCode(buf[pos]);
		pos += 2;
		switch (t) {
			case 'N':
				return null;
			case 'b':
				return readUntil(';') === '1';
			case 'i':
			case 'd':
				return Number(readUntil(';'));
			case 's': {
				const len = Number(readUntil(':'));
				const s = buf.toString('utf8', pos + 1, pos + 1 + len);
				pos += len + 3;
				return s;
			}
			case 'a': {
				const n = Number(readUntil(':'));
				pos += 1;
				const items: [PhpValue, PhpValue][] = [];
				for (let i = 0; i < n; i++) items.push([parse(), parse()]);
				pos += 1;
				if (items.every(([k], i) => k === i)) return items.map(([, x]) => x);
				return Object.fromEntries(items.map(([k, x]) => [String(k), x]));
			}
			default:
				throw new Error('bad');
		}
	};
	try {
		return parse();
	} catch {
		return undefined;
	}
}
