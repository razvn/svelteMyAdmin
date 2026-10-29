/** Tiny tokenizer behind the syntax highlighted SQL / JSON / XML output transformations. */

export type TokenKind = 'keyword' | 'string' | 'number' | 'comment' | 'punct' | 'plain';
export interface Token {
	text: string;
	kind: TokenKind;
}

const SQL_KEYWORDS = new Set(
	(
		'ADD ALL ALTER AND AS ASC BETWEEN BY CASE CREATE CROSS DATABASE DEFAULT DELETE DESC DISTINCT DROP ELSE END ' +
		'EXISTS FROM FULL GROUP HAVING IF IN INDEX INNER INSERT INTO IS JOIN KEY LEFT LIKE LIMIT NOT NULL OFFSET ON ' +
		'OR ORDER OUTER PRIMARY REPLACE RIGHT SELECT SET TABLE THEN UNION UNIQUE UPDATE USING VALUES VIEW WHEN WHERE WITH'
	).split(' ')
);

const SQL_TOKEN =
	/(--[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|('(?:[^'\\]|\\.|'')*'|"(?:[^"\\]|\\.)*")|(`[^`]*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z_0-9$]*)|([\s\S])/g;

export function highlightSql(sql: string): Token[] {
	const out: Token[] = [];
	const push = (text: string, kind: TokenKind) => {
		const last = out[out.length - 1];
		if (last && last.kind === kind) last.text += text;
		else out.push({ text, kind });
	};
	for (const m of sql.matchAll(SQL_TOKEN)) {
		if (m[1]) push(m[1], 'comment');
		else if (m[2]) push(m[2], 'string');
		else if (m[3]) push(m[3], 'plain');
		else if (m[4]) push(m[4], 'number');
		else if (m[5]) push(m[5], SQL_KEYWORDS.has(m[5].toUpperCase()) ? 'keyword' : 'plain');
		else push(m[6], /[(),;]/.test(m[6]) ? 'punct' : 'plain');
	}
	return out;
}
