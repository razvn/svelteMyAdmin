/**
 * SQL statement splitter (equivalent of phpMyAdmin's sql-parser statement
 * splitting for import / the SQL console).
 *
 * Supports `;` and arbitrary `DELIMITER` changes, '…' "…" `…` quoting with
 * backslash escapes (not inside backticks), `-- `, `#` and block comments, and
 * keeps versioned comments (slash-star-bang and slash-star-plus) intact as statement content.
 */

export interface SplitStatement {
	/** Statement text without the terminating delimiter, starting at its first significant token. */
	sql: string;
	/** Offset of the first character of `sql` in the input. */
	start: number;
	/** Offset just after the last character of `sql` (the delimiter is not included). */
	end: number;
	/** Delimiter that terminated (or was in effect for) this statement. */
	delimiter: string;
}

const DELIMITER_RE = /^delimiter(?=[ \t])[ \t]*([^\r\n]*)/i;

function isSpace(c: string): boolean {
	return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
}

/** Parse the argument of a DELIMITER command (first token, optionally quoted). */
function parseDelimiterArg(arg: string): string {
	const trimmed = arg.trim();
	if (trimmed === '') return '';
	const q = trimmed[0];
	if (q === "'" || q === '"' || q === '`') {
		const close = trimmed.indexOf(q, 1);
		if (close > 1) return trimmed.slice(1, close);
	}
	return trimmed.split(/\s+/)[0];
}

export function splitStatements(input: string): SplitStatement[] {
	const out: SplitStatement[] = [];
	const len = input.length;
	let delimiter = ';';
	let i = 0;
	let sigStart = -1; // offset of first significant char of current statement

	const emit = (end: number) => {
		if (sigStart < 0) return;
		let e = end;
		while (e > sigStart && isSpace(input[e - 1])) e--;
		if (e > sigStart) {
			out.push({ sql: input.slice(sigStart, e), start: sigStart, end: e, delimiter });
		}
		sigStart = -1;
	};

	while (i < len) {
		const c = input[i];

		// DELIMITER command: only at the start of a statement.
		if (sigStart < 0 && (c === 'd' || c === 'D')) {
			const m = DELIMITER_RE.exec(input.slice(i, i + 4096));
			if (m) {
				const next = parseDelimiterArg(m[1]);
				if (next !== '') {
					delimiter = next;
					i += m[0].length;
					continue;
				}
			}
		}

		if (isSpace(c)) {
			i++;
			continue;
		}

		// Statement terminator (checked before comments/quotes so custom delimiters win).
		if (input.startsWith(delimiter, i)) {
			emit(i);
			i += delimiter.length;
			continue;
		}

		// Comments
		const isDashComment =
			c === '-' &&
			input[i + 1] === '-' &&
			(i + 2 >= len || isSpace(input[i + 2]) || input.charCodeAt(i + 2) < 32);
		if (c === '#' || isDashComment) {
			let j = i;
			while (j < len && input[j] !== '\n' && input[j] !== '\r') j++;
			// A line comment is significant only inside a statement; otherwise it is dropped.
			i = j;
			continue;
		}
		if (c === '/' && input[i + 1] === '*') {
			const close = input.indexOf('*/', i + 2);
			const j = close === -1 ? len : close + 2;
			const kind = input[i + 2];
			if (kind === '!' || kind === '+') {
				// Executable / hint comment: part of the statement.
				if (sigStart < 0) sigStart = i;
			}
			i = j;
			continue;
		}

		// Any other token starts (or continues) a statement.
		if (sigStart < 0) sigStart = i;

		if (c === "'" || c === '"' || c === '`') {
			let j = i + 1;
			while (j < len) {
				const d = input[j];
				if (d === '\\' && c !== '`') {
					j += 2;
					continue;
				}
				if (d === c) {
					if (input[j + 1] === c) {
						j += 2; // doubled quote
						continue;
					}
					break;
				}
				j++;
			}
			i = Math.min(j + 1, len);
			continue;
		}

		i++;
	}

	emit(len);
	return out;
}
