/**
 * Minimal SQL tokenizer for the statement analysis helpers (classifier, LIMIT appender, ORDER BY
 * rewrite). It only needs to know strings, quoted identifiers, comments, words and nesting depth.
 */
export type TokenType = 'word' | 'quoted' | 'string' | 'comment' | 'number' | 'punct';

export interface Token {
	type: TokenType;
	text: string;
	start: number;
	end: number;
	/** Parenthesis nesting depth (a `(` has the depth outside of it, the tokens inside have +1). */
	depth: number;
	/** Upper-cased text for words, else ''. */
	upper: string;
}

const WORD_START = /[A-Za-z_$\u0080-￿]/;
const WORD_PART = /[A-Za-z0-9_$\u0080-￿]/;

export function tokenize(sql: string): Token[] {
	const out: Token[] = [];
	const len = sql.length;
	let depth = 0;
	let i = 0;
	const push = (type: TokenType, start: number, end: number) => {
		const text = sql.slice(start, end);
		out.push({ type, text, start, end, depth, upper: type === 'word' ? text.toUpperCase() : '' });
	};
	while (i < len) {
		const c = sql[i];
		if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v') {
			i++;
		} else if (
			c === '#' ||
			(c === '-' && sql[i + 1] === '-' && (i + 2 >= len || /[\s\x00-\x1f]/.test(sql[i + 2])))
		) {
			let j = i;
			while (j < len && sql[j] !== '\n' && sql[j] !== '\r') j++;
			push('comment', i, j);
			i = j;
		} else if (c === '/' && sql[i + 1] === '*') {
			const close = sql.indexOf('*/', i + 2);
			const j = close === -1 ? len : close + 2;
			push('comment', i, j);
			i = j;
		} else if (c === "'" || c === '"' || c === '`') {
			let j = i + 1;
			while (j < len) {
				if (sql[j] === '\\' && c !== '`') {
					j += 2;
					continue;
				}
				if (sql[j] === c) {
					if (sql[j + 1] === c) {
						j += 2;
						continue;
					}
					break;
				}
				j++;
			}
			j = Math.min(j + 1, len);
			push(c === '`' ? 'quoted' : 'string', i, j);
			i = j;
		} else if (WORD_START.test(c)) {
			let j = i + 1;
			while (j < len && WORD_PART.test(sql[j])) j++;
			push('word', i, j);
			i = j;
		} else if (/[0-9]/.test(c)) {
			let j = i + 1;
			while (j < len && /[0-9A-Za-z_.]/.test(sql[j])) j++;
			push('number', i, j);
			i = j;
		} else {
			if (c === ')') depth = Math.max(0, depth - 1);
			push('punct', i, i + 1);
			if (c === '(') depth++;
			i++;
		}
	}
	return out;
}

/** Tokens without comments. */
export const significant = (tokens: Token[]): Token[] => tokens.filter((t) => t.type !== 'comment');

/** Content of a word/backquoted token as an identifier name. */
export function identName(t: Token): string {
	return t.type === 'quoted' ? t.text.slice(1, -1).replaceAll('``', '`') : t.text;
}
