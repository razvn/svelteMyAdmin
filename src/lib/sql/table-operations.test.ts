import { describe, expect, it } from 'vitest';
import {
	buildDropSql,
	buildMaintenanceSql,
	buildOptionClauses,
	buildOptionsAlter,
	buildPartitionSql,
	buildRemovePartitioningSql,
	buildRenameSql,
	buildReorderSql,
	buildTruncateSql,
	maintenanceActionsFor,
	parseCreateOptions,
	partitionOperationsFor,
	retargetTrigger,
	rowFormatsFor,
	tableOptionsFromStatus,
	validateTableName,
	type TableOptions
} from './table-operations.ts';

const innodb: TableOptions = {
	engine: 'InnoDB',
	comment: 'old',
	collation: 'utf8mb4_general_ci',
	packKeys: 'DEFAULT',
	checksum: false,
	delayKeyWrite: false,
	transactional: true,
	pageChecksum: true,
	autoIncrement: '5',
	rowFormat: 'Dynamic'
};
const myisam: TableOptions = { ...innodb, engine: 'MyISAM' };
const aria: TableOptions = { ...innodb, engine: 'Aria' };

describe('basic builders', () => {
	it('reorders', () => {
		expect(buildReorderSql('t', 'a`b', 'desc')).toBe('ALTER TABLE `t` ORDER BY `a``b` DESC');
		expect(buildReorderSql('t', 'a', 'asc')).toBe('ALTER TABLE `t` ORDER BY `a` ASC');
	});
	it('renames / moves', () => {
		expect(buildRenameSql('a', 't', 'b', 'u')).toBe('RENAME TABLE `a`.`t` TO `b`.`u`');
	});
	it('validates names', () => {
		expect(validateTableName('')).toMatch(/empty/);
		expect(validateTableName('a.b')).toMatch(/Invalid/);
		expect(validateTableName('a ')).toMatch(/Invalid/);
		expect(validateTableName('my table')).toBeNull();
	});
	it('truncate / drop / maintenance', () => {
		expect(buildTruncateSql('d', 't')).toBe('TRUNCATE TABLE `d`.`t`');
		expect(buildDropSql('d', 't', true)).toBe('DROP VIEW `d`.`t`');
		expect(buildMaintenanceSql('defragment', 'd', 't')).toBe('ALTER TABLE `d`.`t` ENGINE = InnoDB');
		expect(buildMaintenanceSql('flush', 'd', 't')).toBe('FLUSH TABLE `d`.`t`');
		expect(buildMaintenanceSql('optimize', 'd', 't')).toBe('OPTIMIZE TABLE `d`.`t`');
	});
	it('offers maintenance per engine', () => {
		expect(maintenanceActionsFor('InnoDB', false)).toEqual([
			'analyze',
			'check',
			'checksum',
			'defragment',
			'flush',
			'optimize'
		]);
		expect(maintenanceActionsFor('MyISAM', false)).toContain('repair');
		expect(maintenanceActionsFor('MEMORY', false)).toEqual(['checksum', 'flush']);
		expect(maintenanceActionsFor('', true)).toEqual(['check', 'checksum']);
	});
});

describe('partitions', () => {
	it('builds statements', () => {
		expect(buildPartitionSql('t', 'ANALYZE', ['p0', 'p1'])).toBe(
			'ALTER TABLE `t` ANALYZE PARTITION `p0`, `p1`'
		);
		expect(buildPartitionSql('t', 'COALESCE', ['p0', 'p1'])).toBe(
			'ALTER TABLE `t` COALESCE PARTITION 2'
		);
		expect(buildRemovePartitioningSql('t')).toBe('ALTER TABLE `t` REMOVE PARTITIONING');
	});
	it('picks DROP or COALESCE by method', () => {
		expect(partitionOperationsFor('RANGE COLUMNS')).toContain('DROP');
		expect(partitionOperationsFor('HASH')).toContain('COALESCE');
		expect(partitionOperationsFor('HASH')).not.toContain('DROP');
	});
});

describe('table options', () => {
	it('parses create options', () => {
		expect(parseCreateOptions('row_format=DYNAMIC pack_keys=1 partitioned')).toEqual({
			row_format: 'DYNAMIC',
			pack_keys: '1',
			partitioned: ''
		});
		const o = tableOptionsFromStatus({
			engine: 'Aria',
			comment: '',
			collation: 'c',
			autoIncrement: null,
			rowFormat: 'Page',
			createOptions: 'transactional=0 checksum=1'
		});
		expect(o).toMatchObject({
			transactional: false,
			checksum: true,
			pageChecksum: true,
			autoIncrement: ''
		});
	});
	it('sends nothing when nothing changed', () => {
		expect(
			buildOptionsAlter('t', innodb, {
				comment: 'old',
				engine: 'innodb',
				collation: 'utf8mb4_general_ci',
				autoIncrement: '5',
				rowFormat: 'DYNAMIC'
			})
		).toBeNull();
	});
	it('sends only changed options in one ALTER', () => {
		expect(
			buildOptionsAlter('t', innodb, {
				comment: "it's",
				engine: 'MyISAM',
				collation: 'latin1_swedish_ci',
				charset: 'latin1',
				autoIncrement: '10',
				rowFormat: 'COMPACT'
			})
		).toBe(
			[
				'ALTER TABLE `t`',
				"COMMENT = 'it\\'s'",
				'ENGINE = `MyISAM`',
				'DEFAULT CHARACTER SET `latin1` COLLATE `latin1_swedish_ci`',
				'AUTO_INCREMENT = 10',
				'ROW_FORMAT = COMPACT'
			].join('\n')
		);
	});
	it('ignores options the engine does not support and bad values', () => {
		expect(
			buildOptionClauses(innodb, { packKeys: '1', checksum: true, delayKeyWrite: true })
		).toEqual([]);
		expect(buildOptionClauses(innodb, { autoIncrement: '1; DROP' })).toEqual([]);
	});
	it('handles MyISAM and Aria specific options', () => {
		expect(
			buildOptionClauses(myisam, { packKeys: '1', checksum: true, delayKeyWrite: true })
		).toEqual(['PACK_KEYS = 1', 'CHECKSUM = 1', 'DELAY_KEY_WRITE = 1']);
		expect(buildOptionClauses(aria, { transactional: false, pageChecksum: false })).toEqual([
			'TRANSACTIONAL = 0',
			'PAGE_CHECKSUM = 0'
		]);
	});
	it('lists row formats per engine', () => {
		expect(rowFormatsFor('MyISAM')).toEqual(['FIXED', 'DYNAMIC']);
		expect(rowFormatsFor('MEMORY')).toEqual([]);
	});
});

describe('retargetTrigger', () => {
	it('points a MySQL trigger at another table', () => {
		expect(
			retargetTrigger(
				'CREATE DEFINER=`root`@`%` TRIGGER `trg` BEFORE INSERT ON `old` FOR EACH ROW SET NEW.a = 1',
				'new`t'
			)
		).toBe(
			'CREATE DEFINER=`root`@`%` TRIGGER `trg` BEFORE INSERT ON `new``t` FOR EACH ROW SET NEW.a = 1'
		);
	});
	it('drops the qualifiers MariaDB writes', () => {
		expect(
			retargetTrigger(
				'CREATE DEFINER=`root`@`%` TRIGGER `db1`.trg BEFORE INSERT ON `db1`.old FOR EACH ROW SET NEW.a = 1',
				'new'
			)
		).toBe(
			'CREATE DEFINER=`root`@`%` TRIGGER trg BEFORE INSERT ON `new` FOR EACH ROW SET NEW.a = 1'
		);
	});
});
