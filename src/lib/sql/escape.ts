/**
 * SQL escaping helpers. ALWAYS use these when building SQL with identifiers
 * or literal values; never concatenate user input directly.
 * Mirrors phpMyAdmin's Util::backquote() / DatabaseInterface::escapeString().
 */

/** Quote an identifier with backticks, doubling embedded backticks. */
export function escapeId(name: string): string {
	if (typeof name !== 'string') throw new TypeError('Identifier must be a string');
	if (name === '') throw new Error('Identifier must not be empty');
	if (name.includes('\0')) throw new Error('Identifier must not contain NUL characters');
	return '`' + name.replaceAll('`', '``') + '`';
}

/** Quote and join identifier parts: `db`.`table`.`column`. */
export function escapeQualified(...parts: string[]): string {
	if (parts.length === 0) throw new Error('At least one identifier is required');
	return parts.map(escapeId).join('.');
}

const STRING_ESCAPES: Record<string, string> = {
	'\0': '\\0',
	'\n': '\\n',
	'\r': '\\r',
	'\\': '\\\\',
	"'": "\\'",
	'"': '\\"',
	'\x1a': '\\Z'
};

/**
 * Escape the content of a string literal exactly like mysql_real_escape_string
 * (default sql_mode, no NO_BACKSLASH_ESCAPES). Does not add the surrounding quotes.
 */
export function escapeString(value: string): string {
	// eslint-disable-next-line no-control-regex
	return value.replace(/[\0\n\r\\'"\x1a]/g, (c) => STRING_ESCAPES[c]);
}

/** Escape LIKE wildcards (`%`, `_`) and the escape character itself, then string-escape. */
export function escapeLike(value: string): string {
	return escapeString(value.replace(/[\\%_]/g, (c) => '\\' + c));
}

export type SqlValue =
	string | number | bigint | boolean | Date | Buffer | Uint8Array | null | undefined;

function pad(n: number, len = 2): string {
	return String(n).padStart(len, '0');
}

/**
 * Format a value as a SQL literal:
 * null/undefined -> NULL, numbers/bigints verbatim, booleans -> 1/0,
 * Buffers -> X'hex', Dates -> 'YYYY-MM-DD HH:MM:SS.mmm' (UTC), strings quoted+escaped.
 */
export function quoteValue(value: SqlValue): string {
	if (value === null || value === undefined) return 'NULL';
	switch (typeof value) {
		case 'number':
			if (!Number.isFinite(value)) throw new Error('Cannot quote a non-finite number');
			return String(value);
		case 'bigint':
			return value.toString();
		case 'boolean':
			return value ? '1' : '0';
		case 'string':
			return "'" + escapeString(value) + "'";
	}
	if (value instanceof Date) {
		if (Number.isNaN(value.getTime())) throw new Error('Cannot quote an invalid Date');
		return (
			`'${pad(value.getUTCFullYear(), 4)}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())} ` +
			`${pad(value.getUTCHours())}:${pad(value.getUTCMinutes())}:${pad(value.getUTCSeconds())}.` +
			`${pad(value.getUTCMilliseconds(), 3)}'`
		);
	}
	if (value instanceof Uint8Array) {
		return "X'" + Buffer.from(value).toString('hex') + "'";
	}
	throw new TypeError('Unsupported value type');
}
