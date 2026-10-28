import { describe, expect, it } from 'vitest';
import { splitStatements, StatementSplitter } from './splitter';

function chunked(input: string, size: number) {
	const s = new StatementSplitter();
	const out = [];
	for (let i = 0; i < input.length; i += size) out.push(...s.push(input.slice(i, i + size)));
	out.push(...s.end());
	return out;
}

const SAMPLES: Record<string, string> = {
	strings: "INSERT INTO t VALUES ('a;b', \"c;d\", 'it''s; ok', 'back\\'slash;'); SELECT `x;y`;",
	comments:
		'-- first ; comment\nSELECT 1; # hash ; comment\nSELECT /* in ; block */ 2;\n/* lead */ SELECT 3 -- tail\n;',
	versioned: '/*!40101 SET NAMES utf8 */;\nSELECT /*+ HINT(x) */ 1;\n/*!50003 CREATE TRIGGER x */;',
	delimiter:
		"DELIMITER $$\nCREATE PROCEDURE p()\nBEGIN\n  SELECT 'a;b';\n  SELECT 2;\nEND$$\nDELIMITER ;\nSELECT 3;\ndelimiter //\nSELECT 4//\nDELIMITER ;\nSELECT 5",
	multichar: 'SELECT 1;;\nDELIMITER ;;\nSELECT 2;;\nSELECT 3;;\nDELIMITER ;\nSELECT 4;',
	crlf: 'SELECT 1;\r\nSELECT 2;\r\n-- c\r\nSELECT 3',
	dashes: 'SELECT 1--1; SELECT 2 -- x\n; SELECT 3 - -3;--\nSELECT 4',
	unterminated: "SELECT 1; SELECT 'never closed ;",
	unterminatedComment: 'SELECT 1; /* never closed ; SELECT 2',
	multiline: 'SELECT\n1;\n\n\nSELECT\n  2;\nSELECT 3'
};

describe('StatementSplitter (incremental)', () => {
	for (const [name, sql] of Object.entries(SAMPLES)) {
		it(`${name}: every chunk size gives the same statements as the one-shot split`, () => {
			const whole = splitStatements(sql);
			for (let size = 1; size <= sql.length + 1; size++) {
				expect(chunked(sql, size), `chunk size ${size}`).toEqual(whole);
			}
		});
	}

	it('reports 1-based line numbers of statement starts', () => {
		const text = 'SELECT 1;\n\n  SELECT\n2;\n-- x\nSELECT 3';
		expect(splitStatements(text).map((s) => s.line)).toEqual([1, 3, 6]);
		expect(chunked(text, 3).map((s) => s.line)).toEqual([1, 3, 6]);
	});

	it('does not release a statement before its terminator arrived', () => {
		const s = new StatementSplitter();
		expect(s.push("SELECT 'a;")).toEqual([]);
		expect(s.push("b'")).toEqual([]);
		expect(s.push(';SEL')).toHaveLength(1);
		expect(s.push('ECT 2')).toEqual([]);
		expect(s.end().map((x) => x.sql)).toEqual(['SELECT 2']);
	});

	it('keeps the DELIMITER state across chunks', () => {
		const s = new StatementSplitter();
		const got: string[] = [];
		for (const c of ['DELIM', 'ITER $$\nSELECT 1; SELECT', ' 2$$ SELECT 3$', '$']) {
			got.push(...s.push(c).map((x) => x.sql));
		}
		expect(got).toEqual(['SELECT 1; SELECT 2', 'SELECT 3']);
		expect(s.currentDelimiter).toBe('$$');
	});

	it('accepts an initial delimiter', () => {
		const s = new StatementSplitter('//');
		expect([...s.push('SELECT 1//SELECT 2//'), ...s.end()].map((x) => x.sql)).toEqual([
			'SELECT 1',
			'SELECT 2'
		]);
	});

	it('keeps global offsets across compaction of a large input', () => {
		const stmt = "INSERT INTO t VALUES ('" + 'x'.repeat(1000) + "');\n";
		const input = stmt.repeat(300);
		const r = chunked(input, 5000);
		expect(r).toHaveLength(300);
		expect(r[299].start).toBe(stmt.length * 299);
		expect(r[299].line).toBe(300);
		expect(input.slice(r[150].start, r[150].end)).toBe(r[150].sql);
	});
});
