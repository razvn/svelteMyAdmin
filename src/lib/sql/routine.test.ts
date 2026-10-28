import { describe, expect, it } from 'vitest';
import {
	buildDefinerClause,
	definerToInput,
	formatDefiner,
	parseDefiner,
	splitStoredDefiner
} from './definer.ts';
import {
	buildCreateRoutine,
	buildDropRoutine,
	buildExecutionPlan,
	buildParamList,
	parseDtd,
	parseParameterRows,
	quoteArgument,
	type RoutineDef
} from './routine.ts';
import { buildCreateTrigger, buildDropTrigger } from './trigger.ts';
import { buildCreateEvent, type EventDef } from './event.ts';

const baseDef: RoutineDef = {
	type: 'PROCEDURE',
	name: 'p1',
	definer: '',
	params: [],
	returns: { type: 'INT', length: '', opts: '' },
	definition: 'SELECT 1',
	deterministic: false,
	securityType: '',
	sqlDataAccess: '',
	comment: ''
};

describe('definer', () => {
	it('parses and quotes user@host', () => {
		expect(parseDefiner('root@localhost')).toEqual({ user: 'root', host: 'localhost' });
		expect(parseDefiner('`a``b`@`%`')).toEqual({ user: 'a`b', host: '%' });
		expect(parseDefiner("'x'@'10.0.0.%'")).toEqual({ user: 'x', host: '10.0.0.%' });
		expect(parseDefiner('nohost')).toBeNull();
		expect(formatDefiner({ user: 'a`b', host: '%' })).toBe('`a``b`@`%`');
	});
	it('builds clauses', () => {
		expect(buildDefinerClause('')).toEqual({ clause: '', error: null });
		expect(buildDefinerClause('root@%').clause).toBe('DEFINER=`root`@`%` ');
		expect(buildDefinerClause('`root`@`%`').clause).toBe('DEFINER=`root`@`%` ');
		expect(buildDefinerClause('CURRENT_USER()').clause).toBe('DEFINER=CURRENT_USER ');
		expect(buildDefinerClause('bad').error).toMatch(/username@hostname/);
	});
	it('splits stored definers on the last @', () => {
		expect(splitStoredDefiner('we@ird@host')).toEqual({ user: 'we@ird', host: 'host' });
		expect(definerToInput('root@%')).toBe('root@%');
	});
});

describe('buildCreateRoutine', () => {
	it('builds a procedure with IN/OUT params', () => {
		const r = buildCreateRoutine('d', {
			...baseDef,
			params: [
				{ direction: 'IN', name: 'a', type: 'int', length: '', opts: 'unsigned' },
				{ direction: 'OUT', name: 'b', type: 'VARCHAR', length: '20', opts: 'utf8mb4' }
			],
			definer: 'root@%',
			comment: "it's",
			deterministic: true,
			sqlDataAccess: 'READS SQL DATA',
			securityType: 'INVOKER',
			definition: 'BEGIN SELECT 1; END'
		});
		expect(r.errors).toEqual([]);
		expect(r.sql).toBe(
			"CREATE DEFINER=`root`@`%` PROCEDURE `d`.`p1`(IN `a` INT UNSIGNED, OUT `b` VARCHAR(20) CHARSET utf8mb4) COMMENT 'it\\'s' DETERMINISTIC READS SQL DATA SQL SECURITY INVOKER BEGIN SELECT 1; END"
		);
	});
	it('builds a function without directions', () => {
		const r = buildCreateRoutine('d', {
			...baseDef,
			type: 'FUNCTION',
			name: 'f`x',
			params: [{ direction: 'OUT', name: 'a', type: 'DECIMAL', length: '10,2', opts: '' }],
			returns: { type: 'varchar', length: '5', opts: '' },
			definition: 'RETURN 1'
		});
		expect(r.errors).toEqual([]);
		expect(r.sql).toBe(
			'CREATE FUNCTION `d`.`f``x`(`a` DECIMAL(10,2)) RETURNS VARCHAR(5) NOT DETERMINISTIC RETURN 1'
		);
	});
	it('collects errors', () => {
		const r = buildCreateRoutine('d', {
			...baseDef,
			name: '',
			definition: '',
			definer: 'x',
			params: [
				{ direction: 'IN', name: '', type: 'INT', length: '', opts: '' },
				{ direction: 'IN', name: 'v', type: 'VARCHAR', length: '', opts: '' }
			]
		});
		expect(r.errors.length).toBeGreaterThanOrEqual(3);
		const f = buildCreateRoutine('d', {
			...baseDef,
			type: 'FUNCTION',
			returns: { type: 'NOPE', length: '', opts: '' }
		});
		expect(f.errors).toContain('You must provide a valid return type for the routine.');
	});
	it('rejects injection through length/options', () => {
		const errors: string[] = [];
		buildParamList(
			'PROCEDURE',
			[{ direction: 'IN', name: 'a', type: 'VARCHAR', length: '1); DROP TABLE x; --', opts: '' }],
			errors
		);
		expect(errors.length).toBe(1);
		const e2: string[] = [];
		buildParamList(
			'PROCEDURE',
			[{ direction: 'IN', name: 'a', type: 'CHAR', length: '1', opts: 'x; DROP' }],
			e2
		);
		expect(e2.length).toBe(1);
	});
	it('accepts ENUM value lists and skips length for TEXT', () => {
		const errors: string[] = [];
		expect(
			buildParamList(
				'FUNCTION',
				[
					{ direction: 'IN', name: 'e', type: 'ENUM', length: "'a','b'", opts: '' },
					{ direction: 'IN', name: 't', type: 'TEXT', length: '10', opts: '' }
				],
				errors
			)
		).toBe("`e` ENUM('a','b'), `t` TEXT");
		expect(errors).toEqual([]);
	});
	it('builds DROP', () => {
		expect(buildDropRoutine('d', 'FUNCTION', 'f')).toBe('DROP FUNCTION `d`.`f`');
	});
});

describe('parseDtd / parseParameterRows', () => {
	it('parses MySQL and MariaDB forms', () => {
		expect(parseDtd('int unsigned')).toEqual({ type: 'INT', length: '', opts: 'UNSIGNED' });
		expect(parseDtd('int(10) unsigned zerofill')).toEqual({
			type: 'INT',
			length: '10',
			opts: 'UNSIGNED ZEROFILL'
		});
		expect(parseDtd('decimal(10,2)')).toEqual({ type: 'DECIMAL', length: '10,2', opts: '' });
		expect(parseDtd('varchar(20)', 'utf8mb4')).toEqual({
			type: 'VARCHAR',
			length: '20',
			opts: 'utf8mb4'
		});
		expect(parseDtd('varchar(20) CHARSET latin1 COLLATE latin1_bin')).toEqual({
			type: 'VARCHAR',
			length: '20',
			opts: 'latin1'
		});
		expect(parseDtd("enum('a)','b')", 'utf8mb4')).toEqual({
			type: 'ENUM',
			length: "'a)','b'",
			opts: 'utf8mb4'
		});
		expect(parseDtd('text', 'utf8mb4').opts).toBe('utf8mb4');
		expect(parseDtd('datetime(3)')).toEqual({ type: 'DATETIME', length: '3', opts: '' });
	});
	it('separates the return row and defaults the mode', () => {
		const out = parseParameterRows([
			{ ordinal: 2, mode: null, name: 'b', dtd: 'varchar(5)', charset: 'utf8mb4' },
			{ ordinal: 0, mode: null, name: null, dtd: 'int', charset: null },
			{ ordinal: 1, mode: 'IN', name: 'a', dtd: 'int(11)', charset: null }
		]);
		expect(out.returns.type).toBe('INT');
		expect(out.params.map((p) => [p.direction, p.name, p.type])).toEqual([
			['IN', 'a', 'INT'],
			['IN', 'b', 'VARCHAR']
		]);
	});
});

describe('execution plan', () => {
	it('quotes arguments by type', () => {
		expect(quoteArgument('INT', ' 5 ', false)).toBe('5');
		expect(quoteArgument('INT', 'x', false)).toBe("'x'");
		expect(quoteArgument('VARCHAR', "o'k", false)).toBe("'o\\'k'");
		expect(quoteArgument('VARCHAR', 'a', true)).toBe('NULL');
	});
	it('builds CALL with OUT and INOUT session variables', () => {
		const plan = buildExecutionPlan('d', 'PROCEDURE', 'p', [
			{ direction: 'IN', name: 'a', type: 'INT', value: '3', isNull: false },
			{ direction: 'INOUT', name: 'b', type: 'INT', value: '4', isNull: false },
			{ direction: 'OUT', name: 'c', type: 'VARCHAR', value: '', isNull: false }
		]);
		expect(plan.setup).toEqual(['SET @_sma_p1 = 4']);
		expect(plan.call).toBe('CALL `d`.`p`(3, @_sma_p1, @_sma_p2)');
		expect(plan.outSelect).toBe('SELECT @_sma_p1 AS `b`, @_sma_p2 AS `c`');
	});
	it('builds a function call', () => {
		const plan = buildExecutionPlan('d', 'FUNCTION', 'f', [
			{ direction: 'IN', name: 'a', type: 'INT', value: '3', isNull: false }
		]);
		expect(plan.call).toBe('SELECT `d`.`f`(3) AS `f`');
		expect(plan.outSelect).toBeNull();
	});
});

describe('triggers', () => {
	it('builds create and drop', () => {
		const r = buildCreateTrigger('d', {
			name: 't',
			table: 'ta`b',
			timing: 'BEFORE',
			event: 'INSERT',
			definition: 'SET NEW.a = 1',
			definer: 'root@localhost'
		});
		expect(r.errors).toEqual([]);
		expect(r.sql).toBe(
			'CREATE DEFINER=`root`@`localhost` TRIGGER `d`.`t` BEFORE INSERT ON `d`.`ta``b` FOR EACH ROW SET NEW.a = 1'
		);
		expect(buildDropTrigger('d', 't')).toBe('DROP TRIGGER `d`.`t`');
		expect(
			buildCreateTrigger('d', {
				name: '',
				table: '',
				timing: 'X' as 'BEFORE',
				event: 'Y' as 'INSERT',
				definition: '',
				definer: ''
			}).errors.length
		).toBe(5);
	});
});

describe('events', () => {
	const ev: EventDef = {
		name: 'e',
		status: 'ENABLED',
		type: 'RECURRING',
		executeAt: '',
		intervalValue: '5',
		intervalField: 'MINUTE',
		starts: '2030-01-01 00:00:00',
		ends: '',
		definition: 'DO_NOT_USE',
		preserve: true,
		definer: '',
		comment: "c'd"
	};
	it('builds recurring and one-time events', () => {
		expect(buildCreateEvent('d', { ...ev, definition: 'SELECT 1' })).toEqual({
			sql: "CREATE EVENT `d`.`e` ON SCHEDULE EVERY 5 MINUTE STARTS '2030-01-01 00:00:00' ON COMPLETION PRESERVE ENABLE COMMENT 'c\\'d' DO SELECT 1",
			errors: []
		});
		const one = buildCreateEvent('d', {
			...ev,
			type: 'ONE TIME',
			executeAt: '2030-01-01 00:00:00',
			status: 'SLAVESIDE_DISABLED',
			preserve: false,
			comment: '',
			definition: 'SELECT 1'
		});
		expect(one.sql).toBe(
			"CREATE EVENT `d`.`e` ON SCHEDULE AT '2030-01-01 00:00:00' ON COMPLETION NOT PRESERVE DISABLE ON SLAVE DO SELECT 1"
		);
	});
	it('validates', () => {
		expect(
			buildCreateEvent('d', { ...ev, intervalField: 'FORTNIGHT', definition: '' }).errors.length
		).toBe(2);
		expect(
			buildCreateEvent('d', {
				...ev,
				intervalField: 'YEAR_MONTH',
				intervalValue: '1-2',
				definition: 'x'
			}).sql
		).toContain("EVERY '1-2' YEAR_MONTH");
	});
});
