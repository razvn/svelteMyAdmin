import { describe, expect, it } from 'vitest';
import { buildColumnSpec, type ServerCaps } from './column-definition.ts';
import { columnFromInfo, type InfoColumnRow } from './column-from-info.ts';

const mysql: ServerCaps = { serverType: 'MySQL', version: 80404 };
const maria: ServerCaps = { serverType: 'MariaDB', version: 110406 };
const row = (o: Partial<InfoColumnRow>): InfoColumnRow => ({
	name: 'c',
	columnType: 'int',
	nullable: false,
	columnDefault: null,
	extra: '',
	collation: null,
	comment: '',
	generationExpression: null,
	...o
});
const spec = (o: Partial<InfoColumnRow>, caps = mysql) =>
	buildColumnSpec(columnFromInfo(row(o), caps), caps);

describe('columnFromInfo', () => {
	it('integers with attributes and auto increment', () => {
		const c = columnFromInfo(
			row({ columnType: 'bigint unsigned', extra: 'auto_increment' }),
			mysql
		);
		expect(c).toMatchObject({ type: 'BIGINT', attribute: 'UNSIGNED', autoIncrement: true });
		expect(spec({ columnType: 'int(10) unsigned zerofill' }, maria)).toBe(
			'`c` INT(10) UNSIGNED ZEROFILL NOT NULL'
		);
	});
	it('lengths, enums with parentheses, collation, comment', () => {
		expect(spec({ columnType: 'decimal(10,2)', nullable: true })).toBe('`c` DECIMAL(10,2) NULL');
		const c = columnFromInfo(
			row({ columnType: "enum('a)','b')", collation: 'utf8mb4_bin', comment: 'x' }),
			mysql
		);
		expect(c.length).toBe("'a)','b'");
		expect(buildColumnSpec(c, mysql)).toBe(
			"`c` ENUM('a)','b') CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL COMMENT 'x'"
		);
	});
	it('MySQL defaults', () => {
		expect(spec({ columnType: 'varchar(5)', columnDefault: "it's" })).toBe(
			"`c` VARCHAR(5) NOT NULL DEFAULT 'it\\'s'"
		);
		expect(
			spec({
				columnType: 'timestamp(3)',
				columnDefault: 'CURRENT_TIMESTAMP(3)',
				extra: 'DEFAULT_GENERATED on update CURRENT_TIMESTAMP(3)'
			})
		).toBe('`c` TIMESTAMP(3) on update CURRENT_TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)');
		expect(spec({ nullable: true })).toBe('`c` INT NULL');
		expect(spec({ columnType: 'bit(3)', columnDefault: "b'101'" })).toBe(
			"`c` BIT(3) NOT NULL DEFAULT b'101'"
		);
	});
	it('MariaDB defaults are SQL literals', () => {
		expect(spec({ columnType: 'varchar(5)', columnDefault: "'it\\'s'" }, maria)).toBe(
			"`c` VARCHAR(5) NOT NULL DEFAULT 'it\\'s'"
		);
		expect(spec({ columnDefault: '7' }, maria)).toBe("`c` INT NOT NULL DEFAULT '7'");
		expect(spec({ nullable: true, columnDefault: 'NULL' }, maria)).toBe(
			'`c` INT NULL DEFAULT NULL'
		);
		expect(spec({ columnDefault: 'NULL' }, maria)).toBe('`c` INT NOT NULL');
		expect(spec({ columnType: 'datetime', columnDefault: 'current_timestamp()' }, maria)).toBe(
			'`c` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP'
		);
		expect(spec({ columnType: 'uuid', columnDefault: 'uuid()' }, maria)).toBe(
			'`c` UUID NOT NULL DEFAULT uuid()'
		);
	});
	it('generated columns', () => {
		const c = columnFromInfo(
			row({ extra: 'STORED GENERATED', generationExpression: "concat(`a`,_utf8mb4\\'x\\')" }),
			mysql
		);
		expect(c).toMatchObject({ virtuality: 'STORED', expression: "concat(`a`,_utf8mb4'x')" });
		expect(buildColumnSpec(c, mysql)).toContain("AS (concat(`a`,_utf8mb4'x')) STORED");
	});
	it('binary defaults become hex', () => {
		expect(spec({ columnType: 'varbinary(4)', columnDefault: 'ab' })).toBe(
			'`c` VARBINARY(4) NOT NULL DEFAULT 0x6162'
		);
	});
});
