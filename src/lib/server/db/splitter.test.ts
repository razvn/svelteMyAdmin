import { describe, expect, it } from 'vitest';
import { splitStatements } from './splitter';

const sqls = (s: string) => splitStatements(s).map((x) => x.sql);

describe('splitStatements basics', () => {
	it('returns nothing for empty / whitespace / comment-only input', () => {
		expect(splitStatements('')).toEqual([]);
		expect(splitStatements('  \n\t ')).toEqual([]);
		expect(splitStatements('-- just a comment\n# another\n/* block */')).toEqual([]);
		expect(splitStatements(';;;')).toEqual([]);
	});

	it('splits on semicolons', () => {
		expect(sqls('SELECT 1; SELECT 2;\nSELECT 3')).toEqual(['SELECT 1', 'SELECT 2', 'SELECT 3']);
	});

	it('reports start/end offsets', () => {
		const src = '  SELECT 1;\n\n  SELECT 2  ;';
		const r = splitStatements(src);
		expect(r).toHaveLength(2);
		for (const s of r) expect(src.slice(s.start, s.end)).toBe(s.sql);
		expect(r[0].start).toBe(2);
		expect(r[1].start).toBe(src.indexOf('SELECT 2'));
		expect(r[1].sql).toBe('SELECT 2');
	});

	it('handles CRLF line endings', () => {
		expect(sqls('SELECT 1;\r\nSELECT 2;\r\n')).toEqual(['SELECT 1', 'SELECT 2']);
	});

	it('keeps a trailing statement without delimiter', () => {
		expect(sqls('SELECT 1;SELECT 2')).toEqual(['SELECT 1', 'SELECT 2']);
	});
});

describe('quotes', () => {
	it('ignores delimiters inside single quotes', () => {
		expect(sqls("INSERT INTO t VALUES ('a;b'); SELECT 1")).toEqual([
			"INSERT INTO t VALUES ('a;b')",
			'SELECT 1'
		]);
	});
	it('ignores delimiters inside double quotes and backticks', () => {
		expect(sqls('SELECT "a;b"; SELECT `c;d`')).toEqual(['SELECT "a;b"', 'SELECT `c;d`']);
	});
	it('handles backslash escapes', () => {
		expect(sqls("SELECT 'it\\'s; ok'; SELECT 2")).toEqual(["SELECT 'it\\'s; ok'", 'SELECT 2']);
		expect(sqls("SELECT '\\\\'; SELECT 2")).toEqual(["SELECT '\\\\'", 'SELECT 2']);
	});
	it('handles doubled quotes', () => {
		expect(sqls("SELECT 'it''s;'; SELECT 2")).toEqual(["SELECT 'it''s;'", 'SELECT 2']);
		expect(sqls('SELECT `a``;b`; SELECT 2')).toEqual(['SELECT `a``;b`', 'SELECT 2']);
	});
	it('does not treat backslash as escape inside backticks', () => {
		expect(sqls('SELECT `a\\`; SELECT 2')).toEqual(['SELECT `a\\`', 'SELECT 2']);
	});
	it('unterminated quote swallows the rest', () => {
		expect(sqls("SELECT 'abc; SELECT 2")).toEqual(["SELECT 'abc; SELECT 2"]);
	});
	it('comment markers inside strings are not comments', () => {
		expect(sqls("SELECT '-- x', '/* y', '# z'; SELECT 2")).toEqual([
			"SELECT '-- x', '/* y', '# z'",
			'SELECT 2'
		]);
	});
});

describe('comments', () => {
	it('drops leading comments but keeps statement start offset after them', () => {
		const src = '-- hello\nSELECT 1;';
		const [s] = splitStatements(src);
		expect(s.sql).toBe('SELECT 1');
		expect(s.start).toBe(9);
	});
	it('ignores semicolons in line comments', () => {
		expect(sqls('SELECT 1 -- a; b\n, 2; SELECT 3')).toEqual(['SELECT 1 -- a; b\n, 2', 'SELECT 3']);
		expect(sqls('SELECT 1 # a; b\n; SELECT 3')).toEqual(['SELECT 1 # a; b', 'SELECT 3']);
	});
	it('requires whitespace after --', () => {
		// `1--1` is arithmetic, not a comment
		expect(sqls('SELECT 1--1; SELECT 2')).toEqual(['SELECT 1--1', 'SELECT 2']);
		expect(sqls('SELECT 1 --\n; SELECT 2')).toEqual(['SELECT 1 --', 'SELECT 2']);
		expect(sqls('SELECT 1; --')).toEqual(['SELECT 1']);
	});
	it('ignores semicolons in block comments', () => {
		expect(sqls('SELECT /* a; b */ 1; SELECT 2')).toEqual(['SELECT /* a; b */ 1', 'SELECT 2']);
	});
	it('unterminated block comment runs to the end', () => {
		expect(sqls('SELECT 1; /* oops; SELECT 2')).toEqual(['SELECT 1']);
	});
	it('keeps versioned comments intact', () => {
		expect(sqls('/*!40101 SET NAMES utf8 */;\nSELECT 1;')).toEqual([
			'/*!40101 SET NAMES utf8 */',
			'SELECT 1'
		]);
		expect(sqls('SELECT /*!50000 SQL_NO_CACHE */ 1;')).toEqual([
			'SELECT /*!50000 SQL_NO_CACHE */ 1'
		]);
	});
	it('keeps optimizer hints', () => {
		expect(sqls('SELECT /*+ MAX_EXECUTION_TIME(10) */ 1;')).toEqual([
			'SELECT /*+ MAX_EXECUTION_TIME(10) */ 1'
		]);
	});
	it('a comment between statements is not its own statement', () => {
		expect(sqls('SELECT 1; /* x */ ; -- y\nSELECT 2;')).toEqual(['SELECT 1', 'SELECT 2']);
	});
});

describe('DELIMITER', () => {
	const proc = [
		'DELIMITER $$',
		'CREATE PROCEDURE p()',
		'BEGIN',
		'  SELECT 1;',
		'  SELECT 2;',
		'END$$',
		'DELIMITER ;',
		'SELECT 3;'
	].join('\n');

	it('supports custom delimiters and resets', () => {
		const r = splitStatements(proc);
		expect(r.map((s) => s.sql)).toEqual([
			'CREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\n  SELECT 2;\nEND',
			'SELECT 3'
		]);
		expect(r[0].delimiter).toBe('$$');
		expect(r[1].delimiter).toBe(';');
	});
	it('works with // and multi-char delimiters', () => {
		expect(sqls('DELIMITER //\nSELECT 1; SELECT 2//\nSELECT 3//')).toEqual([
			'SELECT 1; SELECT 2',
			'SELECT 3'
		]);
		expect(sqls('delimiter ;;\nSELECT 1;;')).toEqual(['SELECT 1']);
	});
	it('is case-insensitive and allows CRLF', () => {
		expect(sqls('Delimiter $$\r\nSELECT 1;$$\r\nDELIMITER ;\r\nSELECT 2;')).toEqual([
			'SELECT 1;',
			'SELECT 2'
		]);
	});
	it('does not emit DELIMITER lines as statements and gives offsets for later ones', () => {
		const r = splitStatements(proc);
		expect(proc.slice(r[0].start, r[0].end)).toBe(r[0].sql);
		expect(proc.slice(r[1].start, r[1].end)).toBe('SELECT 3');
	});
	it('does not treat delimiter inside a statement or as an identifier prefix', () => {
		expect(sqls('SELECT 1 delimiter $$; SELECT 2')).toEqual(['SELECT 1 delimiter $$', 'SELECT 2']);
		expect(sqls('delimiter_tbl;')).toEqual(['delimiter_tbl']);
	});
	it('quotes in custom delimiter bodies still protect delimiters', () => {
		expect(sqls("DELIMITER $$\nSELECT '$$'$$\nSELECT 2$$")).toEqual(["SELECT '$$'", 'SELECT 2']);
	});
	it('accepts a quoted delimiter argument', () => {
		expect(sqls("DELIMITER '$$'\nSELECT 1$$")).toEqual(['SELECT 1']);
	});
	it('trailing comment after DELIMITER argument line is separate', () => {
		expect(sqls('DELIMITER $$\n-- c\nSELECT 1$$')).toEqual(['SELECT 1']);
	});
});

describe('realistic dump', () => {
	it('splits a mysqldump-like script', () => {
		const dump = `-- MySQL dump
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
DROP TABLE IF EXISTS \`t\`;
CREATE TABLE \`t\` (
  \`id\` int NOT NULL, -- pk;
  \`v\` varchar(10) DEFAULT 'a;b'
) ENGINE=InnoDB;
INSERT INTO \`t\` VALUES (1,'x\\';y');
DELIMITER ;;
CREATE TRIGGER trg BEFORE INSERT ON t FOR EACH ROW BEGIN SET NEW.id = 1; END ;;
DELIMITER ;
`;
		const r = splitStatements(dump);
		expect(r).toHaveLength(5);
		expect(r[0].sql.startsWith('/*!40101')).toBe(true);
		expect(r[2].sql).toContain("DEFAULT 'a;b'");
		expect(r[3].sql).toBe("INSERT INTO `t` VALUES (1,'x\\';y')");
		expect(r[4].sql).toBe(
			'CREATE TRIGGER trg BEFORE INSERT ON t FOR EACH ROW BEGIN SET NEW.id = 1; END'
		);
	});
});
