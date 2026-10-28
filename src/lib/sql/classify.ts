/** Statement type detection (the useful part of sql-parser's Statement classes). */
import { significant, tokenize } from './tokens.ts';

export type StatementKind = 'select' | 'show' | 'explain' | 'dml' | 'ddl' | 'other';

const DML = new Set(['INSERT', 'UPDATE', 'DELETE', 'REPLACE', 'LOAD']);
const DDL = new Set(['CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME']);

export function classifyStatement(sql: string): StatementKind {
	const tokens = significant(tokenize(sql));
	const first = tokens.find((t) => t.type !== 'punct' || t.text !== '(');
	if (!first || first.type !== 'word') return 'other';
	const w = first.upper;
	if (w === 'SELECT' || w === 'TABLE' || w === 'VALUES') return 'select';
	if (w === 'WITH') {
		const verb = tokens.find(
			(t) =>
				t.depth === 0 &&
				t.type === 'word' &&
				['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'REPLACE'].includes(t.upper)
		);
		return verb && verb.upper !== 'SELECT' ? 'dml' : 'select';
	}
	if (w === 'SHOW') return 'show';
	if (w === 'EXPLAIN' || w === 'DESCRIBE' || w === 'DESC') return 'explain';
	if (DML.has(w)) return 'dml';
	if (DDL.has(w)) return 'ddl';
	return 'other';
}
