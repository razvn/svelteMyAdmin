/**
 * SQL statement splitter (equivalent of phpMyAdmin's sql-parser statement
 * splitting for import / the SQL console).
 *
 * Supports `;` and arbitrary `DELIMITER` changes, '…' "…" `…` quoting with
 * backslash escapes (not inside backticks), `-- `, `#` and block comments, and
 * keeps versioned comments (slash-star-bang and slash-star-plus) intact as statement content.
 *
 * `StatementSplitter` is the incremental form (feed chunks, get complete statements back) used by the
 * streaming importer; `splitStatements` is a one-shot wrapper around it.
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
	/** 1-based line number of the first character of `sql`. */
	line: number;
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

const COMPACT_THRESHOLD = 1 << 16;

function countNewlines(s: string, from: number, to: number): number {
	let n = 0;
	let k = from;
	while ((k = s.indexOf('\n', k)) !== -1 && k < to) {
		n++;
		k++;
	}
	return n;
}

/**
 * Incremental statement splitter. `push(chunk)` returns the statements that are complete so far;
 * `end()` flushes the last one. Tokens that straddle a chunk boundary (strings, comments, a
 * `DELIMITER` line, a multi-character delimiter, `--`) are held back until enough input arrived,
 * so any chunking gives the same result as splitting the whole text at once.
 */
export class StatementSplitter {
	private buf = '';
	/** Global offset of `buf[0]`. */
	private base = 0;
	private i = 0;
	private sigStart = -1;
	/** Resume index of an unfinished quote/comment token that starts at `i`. */
	private tokJ = -1;
	private delimiter: string;
	/** `lineNo` is the line number at `buf[lineIdx]`. */
	private lineIdx = 0;
	private lineNo = 1;
	private out: SplitStatement[] = [];

	constructor(delimiter = ';') {
		this.delimiter = delimiter;
	}

	/** Delimiter currently in effect. */
	get currentDelimiter(): string {
		return this.delimiter;
	}

	push(chunk: string): SplitStatement[] {
		this.buf += chunk;
		this.scan(false);
		return this.drain();
	}

	end(): SplitStatement[] {
		this.scan(true);
		return this.drain();
	}

	private drain(): SplitStatement[] {
		const r = this.out;
		this.out = [];
		return r;
	}

	private lineOf(idx: number): number {
		this.lineNo += countNewlines(this.buf, this.lineIdx, idx);
		this.lineIdx = idx;
		return this.lineNo;
	}

	private emit(end: number) {
		const input = this.buf;
		if (this.sigStart < 0) return;
		let e = end;
		while (e > this.sigStart && isSpace(input[e - 1])) e--;
		if (e > this.sigStart) {
			this.out.push({
				sql: input.slice(this.sigStart, e),
				start: this.base + this.sigStart,
				end: this.base + e,
				delimiter: this.delimiter,
				line: this.lineOf(this.sigStart)
			});
		}
		this.sigStart = -1;
	}

	private compact() {
		const cut = this.sigStart >= 0 ? Math.min(this.sigStart, this.i) : this.i;
		if (cut < COMPACT_THRESHOLD && cut < this.buf.length) return;
		this.lineOf(cut);
		this.buf = this.buf.slice(cut);
		this.base += cut;
		this.i -= cut;
		if (this.sigStart >= 0) this.sigStart -= cut;
		if (this.tokJ >= 0) this.tokJ -= cut;
		this.lineIdx = 0;
	}

	private scan(final: boolean) {
		const input = this.buf;
		const len = input.length;
		let i = this.i;

		scanLoop: while (i < len) {
			const c = input[i];

			// DELIMITER command: only at the start of a statement.
			if (this.sigStart < 0 && (c === 'd' || c === 'D')) {
				const rest = input.slice(i, i + 4096);
				const m = DELIMITER_RE.exec(rest);
				if (m) {
					if (!final && i + m[0].length >= len) break; // argument line not complete yet
					const next = parseDelimiterArg(m[1]);
					if (next !== '') {
						this.delimiter = next;
						i += m[0].length;
						continue;
					}
				} else if (!final && rest.length <= 9 && 'delimiter'.startsWith(rest.toLowerCase())) {
					break;
				}
			}

			if (isSpace(c)) {
				i++;
				continue;
			}

			// Statement terminator (checked before comments/quotes so custom delimiters win).
			if (input.startsWith(this.delimiter, i)) {
				this.emit(i);
				i += this.delimiter.length;
				continue;
			}
			if (!final && len - i < this.delimiter.length && this.delimiter.startsWith(input.slice(i))) {
				break;
			}

			// Comments
			if (c === '-' && !final && (i + 1 >= len || (input[i + 1] === '-' && i + 2 >= len))) break;
			const isDashComment =
				c === '-' &&
				input[i + 1] === '-' &&
				(i + 2 >= len || isSpace(input[i + 2]) || input.charCodeAt(i + 2) < 32);
			if (c === '#' || isDashComment) {
				let j = this.tokJ >= 0 ? this.tokJ : i;
				while (j < len && input[j] !== '\n' && input[j] !== '\r') j++;
				if (j >= len && !final) {
					this.tokJ = j;
					break;
				}
				this.tokJ = -1;
				// A line comment is significant only inside a statement; otherwise it is dropped.
				i = j;
				continue;
			}
			if (c === '/' && !final && i + 1 >= len) break;
			if (c === '/' && input[i + 1] === '*') {
				const from = Math.max(i + 2, this.tokJ >= 0 ? this.tokJ : 0);
				const close = input.indexOf('*/', from);
				if (close === -1 && !final) {
					this.tokJ = Math.max(i + 2, len - 1);
					break;
				}
				this.tokJ = -1;
				const j = close === -1 ? len : close + 2;
				const kind = input[i + 2];
				if (kind === '!' || kind === '+') {
					// Executable / hint comment: part of the statement.
					if (this.sigStart < 0) this.sigStart = i;
				}
				i = j;
				continue;
			}

			// Any other token starts (or continues) a statement.
			if (this.sigStart < 0) this.sigStart = i;

			if (c === "'" || c === '"' || c === '`') {
				let j = this.tokJ >= 0 ? this.tokJ : i + 1;
				while (j < len) {
					const d = input[j];
					if (d === '\\' && c !== '`') {
						if (j + 1 >= len && !final) {
							this.tokJ = j;
							break scanLoop;
						}
						j += 2;
						continue;
					}
					if (d === c) {
						if (j + 1 >= len && !final) {
							this.tokJ = j;
							break scanLoop;
						}
						if (input[j + 1] === c) {
							j += 2; // doubled quote
							continue;
						}
						break;
					}
					j++;
				}
				if (j >= len && !final) {
					this.tokJ = j;
					break;
				}
				this.tokJ = -1;
				i = Math.min(j + 1, len);
				continue;
			}

			i++;
		}

		this.i = i;
		if (final) {
			this.emit(len);
			this.i = len;
		}
		this.compact();
	}
}

export function splitStatements(input: string): SplitStatement[] {
	const s = new StatementSplitter();
	return [...s.push(input), ...s.end()];
}
