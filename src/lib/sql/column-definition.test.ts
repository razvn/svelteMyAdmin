import { describe, expect, it } from 'vitest';
import { escapeId, escapeString } from '../server/db/escape';
import {
	buildColumnSpec,
	buildCreateTable,
	buildKeyDefinitions,
	formatEnumValues,
	getAllTypes,
	getAttributes,
	getTypeGroups,
	getVirtualities,
	escapeStr,
	newColumn,
	parseEnumValues,
	quoteId,
	type ColumnDef,
	type ServerCaps
} from './column-definition';

const mysql8: ServerCaps = { serverType: 'MySQL', version: 80404 };
const mysql57: ServerCaps = { serverType: 'MySQL', version: 50740 };
const maria: ServerCaps = { serverType: 'MariaDB', version: 110406 };
const maria10: ServerCaps = { serverType: 'MariaDB', version: 100300 };

const col = (o: Partial<ColumnDef>) => newColumn({ name: 'c', ...o });
const spec = (o: Partial<ColumnDef>, caps = mysql8) => buildColumnSpec(col(o), caps);

describe('escaping helpers', () => {
	it('match the server escape module', () => {
		for (const s of ["a'b", 'x\\y', 'l\nm\r\0\x1a"']) expect(escapeStr(s)).toBe(escapeString(s));
		expect(quoteId('a`b')).toBe(escapeId('a`b'));
	});
});

describe('type catalog', () => {
	const names = (c: ServerCaps) => getTypeGroups(c).map((g) => g.label);
	it('groups for MySQL 8', () => {
		expect(names(mysql8)).toEqual(['Numeric', 'Date and time', 'String', 'Spatial', 'JSON']);
		expect(getAllTypes(mysql8)).not.toContain('UUID');
		expect(getAllTypes(mysql8)).not.toContain('INET6');
	});
	it('MariaDB 11.4 has UUID and INET6', () => {
		expect(names(maria)).toContain('UUID');
		expect(getAllTypes(maria)).toContain('INET6');
	});
	it('old servers drop JSON/INET6/UUID', () => {
		expect(names({ serverType: 'MySQL', version: 50600 })).not.toContain('JSON');
		expect(getAllTypes(maria10)).not.toContain('INET6');
		expect(names(maria10)).toContain('JSON');
	});
	it('attributes and virtualities', () => {
		expect(getAttributes(mysql8)).toEqual([
			'BINARY',
			'UNSIGNED',
			'UNSIGNED ZEROFILL',
			'on update CURRENT_TIMESTAMP'
		]);
		expect(getAttributes(maria)).toContain('COMPRESSED=zlib');
		expect(getVirtualities(mysql8)).toEqual(['VIRTUAL', 'STORED']);
		expect(getVirtualities({ serverType: 'MariaDB', version: 100100 })).toEqual([
			'VIRTUAL',
			'PERSISTENT'
		]);
	});
});

describe('buildColumnSpec', () => {
	it('basic types', () => {
		expect(spec({ type: 'INT' })).toBe('`c` INT NOT NULL');
		expect(spec({ type: 'VARCHAR', length: '255', null: true })).toBe('`c` VARCHAR(255) NULL');
		expect(spec({ type: 'DECIMAL', length: '10,2' })).toBe('`c` DECIMAL(10,2) NOT NULL');
		expect(spec({ name: 'we`ird ' })).toBe('`we``ird` INT NOT NULL');
	});
	it('no length for text/blob/date/json/boolean types', () => {
		for (const t of ['TEXT', 'BLOB', 'DATE', 'JSON', 'BOOLEAN', 'LONGTEXT', 'SERIAL']) {
			expect(spec({ type: t, length: '5' })).toBe(`\`c\` ${t} NOT NULL`);
		}
	});
	it('integer display width: dropped on MySQL >= 8.0.18, kept elsewhere, TINYINT(1) kept', () => {
		expect(spec({ type: 'INT', length: '11' })).toBe('`c` INT NOT NULL');
		expect(spec({ type: 'TINYINT', length: '4' })).toBe('`c` TINYINT NOT NULL');
		expect(spec({ type: 'TINYINT', length: '1' })).toBe('`c` TINYINT(1) NOT NULL');
		expect(spec({ type: 'INT', length: '11' }, mysql57)).toBe('`c` INT(11) NOT NULL');
		expect(spec({ type: 'INT', length: '11' }, maria)).toBe('`c` INT(11) NOT NULL');
	});
	it('attributes keep phpMyAdmin order (type, attribute, null, default, extra)', () => {
		expect(spec({ type: 'INT', attribute: 'UNSIGNED' })).toBe('`c` INT UNSIGNED NOT NULL');
		expect(spec({ type: 'INT', attribute: 'UNSIGNED ZEROFILL', autoIncrement: true })).toBe(
			'`c` INT UNSIGNED ZEROFILL NOT NULL AUTO_INCREMENT'
		);
		expect(spec({ type: 'VARCHAR', length: '9', attribute: 'BINARY' })).toBe(
			'`c` VARCHAR(9) BINARY NOT NULL'
		);
	});
	it('CURRENT_TIMESTAMP variants', () => {
		expect(spec({ type: 'TIMESTAMP', defaultType: 'CURRENT_TIMESTAMP' })).toBe(
			'`c` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP'
		);
		expect(
			spec({
				type: 'TIMESTAMP',
				length: '6',
				defaultType: 'CURRENT_TIMESTAMP',
				attribute: 'on update CURRENT_TIMESTAMP'
			})
		).toBe('`c` TIMESTAMP(6) on update CURRENT_TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)');
		expect(spec({ type: 'DATETIME', length: '3', defaultType: 'CURRENT_TIMESTAMP' })).toBe(
			'`c` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)'
		);
	});
	it('defaults: none / NULL / user defined', () => {
		expect(spec({ defaultType: 'NONE' })).toBe('`c` INT NOT NULL');
		expect(spec({ defaultType: 'NULL', null: true })).toBe('`c` INT NULL DEFAULT NULL');
		// DEFAULT NULL is ignored on a NOT NULL column
		expect(spec({ defaultType: 'NULL', null: false })).toBe('`c` INT NOT NULL');
		expect(spec({ defaultType: 'USER_DEFINED', defaultValue: '5' })).toBe(
			"`c` INT NOT NULL DEFAULT '5'"
		);
		expect(
			spec({ type: 'VARCHAR', length: '9', defaultType: 'USER_DEFINED', defaultValue: "it's\\" })
		).toBe("`c` VARCHAR(9) NOT NULL DEFAULT 'it\\'s\\\\'");
		expect(spec({ type: 'UUID', defaultType: 'UUID' }, maria)).toBe(
			'`c` UUID NOT NULL DEFAULT uuid()'
		);
	});
	it('special default quoting', () => {
		const ud = (type: string, defaultValue: string) =>
			spec({ type, defaultType: 'USER_DEFINED', defaultValue });
		expect(ud('TIMESTAMP', '0')).toBe('`c` TIMESTAMP NOT NULL DEFAULT 0');
		expect(ud('TIMESTAMP', "'2020-01-02 03:04:05'")).toBe(
			"`c` TIMESTAMP NOT NULL DEFAULT '2020-01-02 03:04:05'"
		);
		expect(ud('BIT', '1a1')).toBe("`c` BIT NOT NULL DEFAULT b'101'");
		expect(ud('BOOLEAN', 'true')).toBe('`c` BOOLEAN NOT NULL DEFAULT TRUE');
		expect(ud('BOOLEAN', '1')).toBe('`c` BOOLEAN NOT NULL DEFAULT TRUE');
		expect(ud('BOOLEAN', 'No')).toBe('`c` BOOLEAN NOT NULL DEFAULT FALSE');
		expect(ud('BOOLEAN', 'maybe')).toBe("`c` BOOLEAN NOT NULL DEFAULT 'maybe'");
		expect(ud('BINARY', 'ab12')).toBe('`c` BINARY NOT NULL DEFAULT 0xab12');
		expect(ud('VARBINARY', 'ff')).toBe('`c` VARBINARY NOT NULL DEFAULT 0xff');
	});
	it('collation only on text types; charset derived', () => {
		expect(spec({ type: 'VARCHAR', length: '9', collation: 'utf8mb4_bin' })).toBe(
			'`c` VARCHAR(9) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL'
		);
		expect(spec({ type: 'INT', collation: 'utf8mb4_bin' })).toBe('`c` INT NOT NULL');
		expect(spec({ type: 'TEXT', collation: 'binary' })).toBe(
			'`c` TEXT CHARACTER SET binary NOT NULL'
		);
	});
	it('enum / set values', () => {
		expect(spec({ type: 'ENUM', length: "'a','b','c'" })).toBe("`c` ENUM('a','b','c') NOT NULL");
		expect(spec({ type: 'SET', length: "'x','y'", collation: 'latin1_swedish_ci' })).toBe(
			"`c` SET('x','y') CHARACTER SET latin1 COLLATE latin1_swedish_ci NOT NULL"
		);
	});
	it('comment', () => {
		expect(spec({ comment: "it's" })).toBe("`c` INT NOT NULL COMMENT 'it\\'s'");
	});
	it('generated columns: MySQL keeps NULL, drops default and auto_increment', () => {
		expect(
			spec({
				type: 'INT',
				virtuality: 'STORED',
				expression: 'a + 1',
				defaultType: 'USER_DEFINED',
				defaultValue: '3',
				autoIncrement: true,
				null: true,
				comment: 'x'
			})
		).toBe("`c` INT AS (a + 1) STORED NULL COMMENT 'x'");
	});
	it('generated columns: MariaDB emits no NULL/NOT NULL and strips collation suffix', () => {
		expect(spec({ type: 'INT', virtuality: 'VIRTUAL', expression: 'a * 2' }, maria)).toBe(
			'`c` INT AS (a * 2) VIRTUAL'
		);
		expect(
			spec(
				{
					type: 'VARCHAR',
					length: '10',
					collation: 'utf8mb4_bin',
					virtuality: 'PERSISTENT',
					expression: 'concat(a, b)'
				},
				maria
			)
		).toBe('`c` VARCHAR(10) CHARACTER SET utf8mb4 AS (concat(a, b)) PERSISTENT');
	});
});

describe('buildCreateTable', () => {
	it('full statement with keys and options', () => {
		const cols = [
			col({
				name: 'id',
				type: 'INT',
				attribute: 'UNSIGNED',
				autoIncrement: true,
				index: 'PRIMARY'
			}),
			col({ name: 'email', type: 'VARCHAR', length: '190', index: 'UNIQUE' }),
			col({ name: 'name', type: 'VARCHAR', length: '50', null: true, index: 'INDEX' }),
			col({ name: '', type: 'INT' }),
			col({ name: 'bio', type: 'TEXT', index: 'FULLTEXT' })
		];
		expect(
			buildCreateTable(
				'my`db',
				{ name: ' users ', engine: 'InnoDB', collation: 'utf8mb4_general_ci', comment: "it's" },
				cols,
				mysql8
			)
		).toBe(
			[
				'CREATE TABLE `my``db`.`users` (',
				'  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,',
				'  `email` VARCHAR(190) NOT NULL,',
				'  `name` VARCHAR(50) NULL,',
				'  `bio` TEXT NOT NULL,',
				'  PRIMARY KEY (`id`),',
				'  INDEX (`name`),',
				'  UNIQUE (`email`),',
				'  FULLTEXT (`bio`)',
				") ENGINE = InnoDB CHARSET=utf8mb4 COLLATE utf8mb4_general_ci COMMENT = 'it\\'s';"
			].join('\n')
		);
	});
	it('composite primary key and charset-only collation', () => {
		const cols = [
			col({ name: 'a', index: 'PRIMARY' }),
			col({ name: 'b', index: 'PRIMARY' }),
			col({ name: 'g', type: 'POINT', index: 'SPATIAL' })
		];
		const sql = buildCreateTable('d', { name: 't', collation: 'binary' }, cols, mysql8);
		expect(sql).toContain('PRIMARY KEY (`a`, `b`)');
		expect(sql).toContain('SPATIAL (`g`)');
		expect(sql.endsWith(') CHARSET=binary;')).toBe(true);
	});
	it('auto_increment without key adds a PRIMARY KEY, unless one exists', () => {
		const a = col({ name: 'id', autoIncrement: true });
		expect(buildKeyDefinitions([a])).toEqual(['PRIMARY KEY (`id`)']);
		const b = col({ name: 'k', index: 'PRIMARY' });
		expect(buildKeyDefinitions([b, a])).toEqual(['PRIMARY KEY (`k`)']);
	});
	it('default engine is not emitted; empty table', () => {
		expect(buildCreateTable('d', { name: 't', engine: 'Default' }, [], mysql8)).toBe(
			'CREATE TABLE `d`.`t` ();'
		);
	});
});

describe('enum value lists', () => {
	it('formats with quote doubling', () => {
		expect(formatEnumValues(['a', "b'c", 'd\\e'])).toBe("'a','b''c','d\\\\e'");
	});
	it('parses doubled quotes, backslash escapes and unquoted tokens', () => {
		expect(parseEnumValues("'a','b''c', 'd\\'e'")).toEqual(['a', "b'c", "d'e"]);
		expect(parseEnumValues('x, y')).toEqual(['x', 'y']);
		expect(parseEnumValues('')).toEqual([]);
	});
	it('round-trips', () => {
		const v = ['a', "it's", 'back\\slash', 'a,b'];
		expect(parseEnumValues(formatEnumValues(v))).toEqual(v);
	});
});
