/**
 * Pure helpers of the SQL export plugin: splitting a `SHOW CREATE TABLE` text the way
 * ExportSql::getTableDef() does with the SQL parser (constraints, indexes, AUTO_INCREMENT moved to
 * trailing ALTER TABLE statements), view definition cleanup, value formatting and identifier quoting.
 *
 * SHOW CREATE TABLE output is line oriented (one definition per line, indented by two spaces,
 * string escapes never produce raw newlines), so a line splitter replaces the full parser.
 */
import { escapeString } from '#lib/sql/escape.ts';

/** Reserved words that must stay quoted even with "enclose names with backquotes" off. */
const RESERVED = new Set(
	(
		'ADD ALL ALTER ANALYZE AND AS ASC BEFORE BETWEEN BIGINT BINARY BLOB BOTH BY CALL CASCADE CASE CHANGE CHAR ' +
		'CHARACTER CHECK COLLATE COLUMN CONDITION CONSTRAINT CONTINUE CONVERT CREATE CROSS CURRENT_DATE CURRENT_TIME ' +
		'CURRENT_TIMESTAMP CURRENT_USER CURSOR DATABASE DATABASES DECIMAL DECLARE DEFAULT DELAYED DELETE DESC DESCRIBE ' +
		'DISTINCT DIV DOUBLE DROP EACH ELSE ELSEIF ENCLOSED ESCAPED EXISTS EXIT EXPLAIN FALSE FETCH FLOAT FOR FORCE ' +
		'FOREIGN FROM FULLTEXT GENERATED GRANT GROUP HAVING IF IGNORE IN INDEX INFILE INNER INOUT INSERT INT INTEGER ' +
		'INTERVAL INTO IS ITERATE JOIN KEY KEYS KILL LEADING LEAVE LEFT LIKE LIMIT LINES LOAD LOCK LONG LONGBLOB ' +
		'LONGTEXT LOOP MATCH MEDIUMBLOB MEDIUMINT MEDIUMTEXT MOD NATURAL NOT NULL NUMERIC ON OPTIMIZE OPTION OR ORDER ' +
		'OUT OUTER OUTFILE PRECISION PRIMARY PROCEDURE PURGE RANGE READ READS REAL REFERENCES REGEXP RELEASE RENAME ' +
		'REPEAT REPLACE REQUIRE RESTRICT RETURN REVOKE RIGHT RLIKE SCHEMA SCHEMAS SELECT SET SHOW SMALLINT SPATIAL ' +
		'SQL SSL STARTING STRAIGHT_JOIN TABLE TERMINATED THEN TINYBLOB TINYINT TINYTEXT TO TRAILING TRIGGER TRUE UNDO ' +
		'UNION UNIQUE UNLOCK UNSIGNED UPDATE USAGE USE USING VALUES VARBINARY VARCHAR VARYING WHEN WHERE WHILE WITH ' +
		'WRITE XOR ZEROFILL'
	).split(' ')
);

/** Util::backquoteCompat() (MSSQL mode is not supported by this plugin). */
export function backquote(identifier: string, doIt = true): string {
	if (identifier === '' || identifier === '*') return identifier;
	if (!doIt && !RESERVED.has(identifier.toUpperCase())) return identifier;
	return '`' + identifier.replaceAll('`', '``') + '`';
}

/** Mask quoted strings/identifiers with spaces so regex searches never match inside them. */
export function maskQuoted(text: string): string {
	let out = '';
	let i = 0;
	while (i < text.length) {
		const c = text[i];
		if (c === "'" || c === '"' || c === '`') {
			let j = i + 1;
			while (j < text.length) {
				if (text[j] === '\\' && c !== '`') j += 2;
				else if (text[j] === c) {
					if (text[j + 1] === c) j += 2;
					else break;
				} else j++;
			}
			const end = Math.min(j + 1, text.length);
			out += c + ' '.repeat(Math.max(0, end - i - 2)) + (end - i >= 2 ? c : '');
			i = end;
		} else {
			out += c;
			i++;
		}
	}
	return out;
}

/** Remove the first match of `re` found outside quoted text. */
function removeOutsideQuotes(text: string, re: RegExp): string {
	const m = re.exec(maskQuoted(text));
	return m ? text.slice(0, m.index) + text.slice(m.index + m[0].length) : text;
}

export interface SplitCreateOptions {
	/** `IF NOT EXISTS` mode: keep inline indexes and AUTO_INCREMENT (less efficient, like phpMyAdmin). */
	ifNotExists: boolean;
}

export interface SplitCreate {
	/** CREATE TABLE statement without constraints/indexes/AUTO_INCREMENT (no trailing semicolon). */
	create: string;
	/** `CONSTRAINT ...` definitions (foreign keys, checks). */
	constraints: string[];
	/** Index definitions for `ALTER TABLE ... ADD`. */
	indexes: string[];
	fulltextIndexes: string[];
	/** Column definitions (including AUTO_INCREMENT) for `ALTER TABLE ... MODIFY`. */
	autoIncrement: string[];
	/** Value of the table option `AUTO_INCREMENT=N`, when present. */
	autoIncrementValue: string | null;
}

const KEY_LINE = /^(PRIMARY KEY|UNIQUE KEY|UNIQUE INDEX|KEY|INDEX|SPATIAL KEY|SPATIAL INDEX)\b/;
const AUTO_INC = /\sAUTO_INCREMENT\b(?!=)/;

/**
 * Split a `SHOW CREATE TABLE` statement like ExportSql::getTableDef(). ARCHIVE tables (which cannot
 * be altered) and unrecognised layouts are returned unchanged.
 */
export function splitCreateTable(createQuery: string, opts: SplitCreateOptions): SplitCreate {
	const unchanged: SplitCreate = {
		create: createQuery,
		constraints: [],
		indexes: [],
		fulltextIndexes: [],
		autoIncrement: [],
		autoIncrementValue: null
	};
	const lines = createQuery.split('\n');
	const closeAt = lines.findIndex((l, i) => i > 0 && l.startsWith(')'));
	if (!/^CREATE TABLE\b/.test(lines[0]) || closeAt < 0 || !lines[0].endsWith('(')) return unchanged;

	let tail = lines[closeAt];
	if (/\bENGINE\s*=\s*ARCHIVE\b/i.test(tail)) return unchanged;

	const result: SplitCreate = {
		...unchanged,
		constraints: [],
		indexes: [],
		fulltextIndexes: [],
		autoIncrement: []
	};
	const kept: string[] = [];
	for (const raw of lines.slice(1, closeAt)) {
		let def = raw.trim();
		if (def.endsWith(',')) def = def.slice(0, -1);
		if (/^CONSTRAINT\b/i.test(def)) {
			result.constraints.push(def);
			continue;
		}
		if (/^FULLTEXT\b/.test(def)) {
			result.fulltextIndexes.push(def);
			continue;
		}
		if (KEY_LINE.test(def)) {
			if (opts.ifNotExists) kept.push(def);
			else result.indexes.push(def);
			continue;
		}
		if (!opts.ifNotExists && AUTO_INC.test(maskQuoted(def))) {
			result.autoIncrement.push(def);
			def = removeOutsideQuotes(def, AUTO_INC);
		}
		kept.push(def);
	}

	const ai = /\sAUTO_INCREMENT=(\d+)/.exec(maskQuoted(tail));
	if (ai) {
		result.autoIncrementValue = ai[1];
		if (!opts.ifNotExists) tail = removeOutsideQuotes(tail, /\sAUTO_INCREMENT=\d+/);
	}

	result.create = [
		lines[0],
		kept.map((d) => '  ' + d).join(',\n'),
		tail,
		...lines.slice(closeAt + 1)
	]
		.filter((l, i) => i !== 1 || l !== '')
		.join('\n');
	return result;
}

/** Build the `ALTER TABLE` (+ comment) texts the way getTableDef() does. */
export function alterIndexes(table: string, s: SplitCreate, crlf: string): string {
	let sql = '';
	if (s.indexes.length) {
		sql += `ALTER TABLE ${table}${crlf}  ADD ${s.indexes.join(',' + crlf + '  ADD ')};${crlf}`;
	}
	if (s.fulltextIndexes.length) {
		const head = `ALTER TABLE ${table}`;
		sql += `${head} ADD ${s.fulltextIndexes.join(`;${crlf}${head} ADD `)};${crlf}`;
	}
	return sql;
}

export function alterConstraints(table: string, s: SplitCreate, crlf: string): string {
	if (!s.constraints.length) return '';
	return `ALTER TABLE ${table}${crlf}  ADD ${s.constraints.join(',' + crlf + '  ADD ')};${crlf}`;
}

export function alterAutoIncrement(
	table: string,
	s: SplitCreate,
	crlf: string,
	withValue: boolean
): string {
	if (!s.autoIncrement.length) return '';
	let sql = `ALTER TABLE ${table}${crlf}  MODIFY ${s.autoIncrement.join(',' + crlf + '  MODIFY ')}`;
	if (withValue && s.autoIncrementValue !== null) sql += `, AUTO_INCREMENT=${s.autoIncrementValue}`;
	return sql + `;${crlf}`;
}

// ---- views --------------------------------------------------------------------------------------

const CLAUSE_KEYWORDS =
	/\b(select|from|where|group by|order by|having|limit|union all|union|straight_join|natural|cross join|inner join|left join|right join|left outer join|right outer join|join|on)\b/gi;

/** Upper-case the clause keywords outside quoted text (phpMyAdmin rebuilds the SELECT with the parser). */
export function upperClauseKeywords(sql: string): string {
	const masked = maskQuoted(sql);
	let out = '';
	let last = 0;
	for (const m of masked.matchAll(CLAUSE_KEYWORDS)) {
		out += sql.slice(last, m.index) + m[0].toUpperCase();
		last = m.index + m[0].length;
	}
	return out + sql.slice(last);
}

export interface ViewOptions {
	/** Drop `DEFINER=` ("Exclude definition of current user"). */
	removeDefiner: boolean;
	/** Drop `ALGORITHM`, `DEFINER` and `SQL SECURITY` ("simple view export"). */
	simple: boolean;
	orReplace: boolean;
	/** Database whose `` `db`. `` qualifiers are removed. */
	db: string;
}

/**
 * Port of the view branch of getTableDef(): strip the database qualifier, optional definer /
 * algorithm / security, `OR REPLACE`, and normalise the layout (`VIEW \`v\`  AS SELECT ...`).
 */
export function formatViewDefinition(create: string, opts: ViewOptions): string {
	let q = create.replaceAll(backquote(opts.db) + '.', '');
	const m = /^CREATE\s+(.*?)VIEW\s+(`(?:[^`]|``)+`|\S+)(\s*\([^)]*\))?\s+AS\s+([\s\S]*)$/.exec(q);
	if (!m) return q;
	let options = m[1];
	if (opts.removeDefiner || opts.simple)
		options = options.replace(/DEFINER=(`[^`]*`|[^\s`]+)@(`[^`]*`|[^\s`]+)\s*/, '');
	if (opts.simple) {
		options = options.replace(/ALGORITHM=\w+\s*/, '').replace(/SQL SECURITY\s+\w+\s*/, '');
	}
	options = options.trim();
	const head = 'CREATE' + (opts.orReplace ? ' OR REPLACE' : '') + (options ? ' ' + options : '');
	q = `${head} VIEW ${m[2]}${m[3] ?? ''}  AS ${upperClauseKeywords(m[4])}`;
	return q;
}

// ---- values -------------------------------------------------------------------------------------

export interface ValueField {
	type: string;
	isBinary: boolean;
	isNumeric: boolean;
	length?: number;
}

export interface ValueOptions {
	hexForBinary: boolean;
}

/** Binary string of a BIT value, zero padded to `bits` digits (Util::printableBitValue). */
export function bitString(buf: Uint8Array, bits: number): string {
	let n = 0n;
	for (const b of buf) n = (n << 8n) | BigInt(b);
	return n.toString(2).padStart(bits || 1, '0');
}

/** One SQL literal for a cell, mirroring ExportSql::exportData's per-type branches. */
export function formatValue(
	cell: string | Buffer | Uint8Array | null | undefined,
	field: ValueField,
	opts: ValueOptions
): string {
	if (cell === null || cell === undefined) return 'NULL';
	if (field.isNumeric && typeof cell === 'string') return cell;
	if (typeof cell !== 'string') {
		const buf = Buffer.from(cell);
		if (field.type === 'bit') return "b'" + bitString(buf, field.length ?? buf.length * 8) + "'";
		if (field.type === 'geometry') return '0x' + buf.toString('hex');
		if (field.isBinary && opts.hexForBinary) {
			// empty blobs need to differ from NULL; PHP's empty() quirk also treats "0" as non-empty
			return buf.length === 0 ? "''" : '0x' + buf.toString('hex');
		}
		const text = buf.toString('utf8');
		if (Buffer.from(text, 'utf8').equals(buf))
			return text === '' ? "''" : "'" + escapeString(text) + "'";
		return buf.length === 0 ? "''" : '0x' + buf.toString('hex');
	}
	return cell === '' ? "''" : "'" + escapeString(cell) + "'";
}

export interface InsertBatcherOptions {
	command: 'INSERT' | 'REPLACE' | 'UPDATE';
	/** Table identifier as printed (already quoted). */
	table: string;
	columns: string[];
	delayed: boolean;
	ignore: boolean;
	syntax: 'complete' | 'extended' | 'both' | 'none';
	maxQuerySize: number;
	crlf: string;
}

/**
 * The INSERT/REPLACE statement framing of exportData(): feed it the formatted value lists of each
 * row (`next`) and it yields the text to emit, splitting extended inserts at `max_query_size`.
 * Call `finish()` after the last row. UPDATE rows are built by the caller (`next` gets the full line).
 */
export function createInsertBatcher(o: InsertBatcherOptions) {
	const { crlf } = o;
	let schemaInsert: string;
	let separator = ';';
	const extended = o.command !== 'UPDATE' && (o.syntax === 'extended' || o.syntax === 'both');
	if (o.command === 'UPDATE') {
		schemaInsert = 'UPDATE ' + (o.ignore ? 'IGNORE ' : '') + o.table + ' SET';
	} else {
		let mods = o.delayed ? ' DELAYED' : '';
		if (o.command === 'INSERT' && o.ignore) mods += ' IGNORE';
		schemaInsert =
			o.syntax === 'complete' || o.syntax === 'both'
				? `${o.command}${mods} INTO ${o.table} (${o.columns.join(', ')}) VALUES`
				: `${o.command}${mods} INTO ${o.table} VALUES`;
	}
	if (extended) {
		separator = ',';
		schemaInsert += crlf;
	}
	let currentRow = 0;
	let querySize = 0;

	return {
		/** Rows emitted so far in this run (0 = nothing yet). */
		get rows() {
			return currentRow;
		},
		/** `values` = formatted literals; `updateLine` (` a = 1,b = 2 WHERE ...`) is appended to `UPDATE t SET` for UPDATE statements. */
		next(values: string[], updateLine?: string): string {
			currentRow++;
			let out = '';
			let line: string;
			if (o.command === 'UPDATE') {
				line = schemaInsert + updateLine!;
			} else if (extended) {
				if (currentRow === 1) {
					line = schemaInsert + '(' + values.join(', ') + ')';
				} else {
					line = '(' + values.join(', ') + ')';
					if (o.maxQuerySize > 0 && querySize + line.length > o.maxQuerySize) {
						out += ';' + crlf;
						querySize = 0;
						currentRow = 1;
						line = schemaInsert + line;
					}
				}
				querySize += line.length;
			} else {
				line = schemaInsert + '(' + values.join(', ') + ')';
			}
			return out + (currentRow === 1 ? '' : separator + crlf) + line;
		},
		finish(): string {
			return currentRow > 0 ? ';' + crlf : '';
		}
	};
}
