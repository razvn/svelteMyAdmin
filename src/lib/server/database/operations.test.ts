import { describe, expect, it } from 'vitest';
import {
	orderViews,
	planDatabaseCopy,
	rewriteCreateTable,
	rewriteDefinition,
	type CopyOptions,
	type DatabaseSnapshot
} from './operations';

const CHILD = [
	'CREATE TABLE `child` (',
	'  `id` int NOT NULL AUTO_INCREMENT,',
	'  `pid` int DEFAULT NULL,',
	'  PRIMARY KEY (`id`),',
	'  KEY `fk1` (`pid`),',
	'  CONSTRAINT `fk1` FOREIGN KEY (`pid`) REFERENCES `parent` (`id`) ON DELETE CASCADE',
	') ENGINE=InnoDB AUTO_INCREMENT=42 DEFAULT CHARSET=utf8mb4'
].join('\n');

const snap: DatabaseSnapshot = {
	db: 'src',
	charset: 'utf8mb4',
	collation: 'utf8mb4_unicode_ci',
	tables: [
		{
			name: 'parent',
			createSql:
				'CREATE TABLE `parent` (\n  `id` int NOT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB',
			columns: ['id']
		},
		{ name: 'child', createSql: CHILD, columns: ['id', 'pid'] }
	],
	views: [
		{
			name: 'v_top',
			createSql: 'CREATE VIEW `v_top` AS select `src`.`v_base`.`id` AS `id` from `src`.`v_base`'
		},
		{
			name: 'v_base',
			createSql: 'CREATE VIEW `v_base` AS select `src`.`parent`.`id` AS `id` from `src`.`parent`'
		}
	],
	routines: [{ name: 'p1', type: 'PROCEDURE', createSql: 'CREATE PROCEDURE `p1`() SELECT 1' }],
	events: [{ name: 'e1', createSql: 'CREATE EVENT `e1` ON SCHEDULE EVERY 1 DAY DO SELECT 1' }],
	triggers: [
		{
			name: 'trg',
			table: 'child',
			createSql: 'CREATE TRIGGER `trg` BEFORE INSERT ON `child` FOR EACH ROW SET NEW.pid = 1'
		}
	]
};

const copy: CopyOptions = {
	move: false,
	newName: 'dst',
	what: 'data',
	createDatabase: true,
	dropTable: false,
	autoIncrement: false,
	constraints: true
};

describe('rewriteCreateTable', () => {
	it('qualifies the name, extracts foreign keys and drops AUTO_INCREMENT', () => {
		const r = rewriteCreateTable(CHILD, 'child', 'dst', { autoIncrement: false });
		expect(r.create).toBe(
			[
				'CREATE TABLE `dst`.`child` (',
				'  `id` int NOT NULL AUTO_INCREMENT,',
				'  `pid` int DEFAULT NULL,',
				'  PRIMARY KEY (`id`),',
				'  KEY `fk1` (`pid`)',
				') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4'
			].join('\n')
		);
		expect(r.constraints).toEqual([
			'CONSTRAINT `fk1` FOREIGN KEY (`pid`) REFERENCES `parent` (`id`) ON DELETE CASCADE'
		]);
	});

	it('keeps AUTO_INCREMENT on request', () => {
		const r = rewriteCreateTable(CHILD, 'child', 'dst', { autoIncrement: true });
		expect(r.create).toContain('AUTO_INCREMENT=42');
	});
});

describe('orderViews', () => {
	it('puts a view after the views it selects from', () => {
		expect(orderViews(snap.views).map((v) => v.name)).toEqual(['v_base', 'v_top']);
	});
	it('keeps the input order on cycles', () => {
		const a = { name: 'a', createSql: 'CREATE VIEW a AS select 1 from `b`' };
		const b = { name: 'b', createSql: 'CREATE VIEW b AS select 1 from `a`' };
		expect(orderViews([a, b]).map((v) => v.name)).toEqual(['a', 'b']);
	});
});

describe('rewriteDefinition', () => {
	it('re-targets qualified references to known objects only', () => {
		const sql = 'select `src`.`parent`.`id`, `src`.`alias`.`x` from `src`.`parent` `alias`';
		expect(rewriteDefinition(sql, 'src', 'dst', ['parent'])).toBe(
			'select `dst`.`parent`.`id`, `src`.`alias`.`x` from `dst`.`parent` `alias`'
		);
	});
});

describe('planDatabaseCopy', () => {
	it('copy: structure, data, then constraints, views (ordered), routines, events, triggers', () => {
		const plan = planDatabaseCopy(snap, copy);
		const kinds = plan.map((s) => s.kind);
		expect(plan[0].sql).toBe(
			'CREATE DATABASE IF NOT EXISTS `dst` DEFAULT CHARACTER SET `utf8mb4` COLLATE `utf8mb4_unicode_ci`'
		);
		expect(plan[1].sql).toBe('SET FOREIGN_KEY_CHECKS = 0');
		const idx = (pred: (s: string) => boolean) => plan.findIndex((s) => pred(s.sql));
		const alter = idx((s) => s.startsWith('ALTER TABLE `dst`.`child`'));
		expect(alter).toBeGreaterThan(idx((s) => s.startsWith('INSERT INTO `dst`.`child`')));
		expect(plan[alter].sql).toContain('ADD CONSTRAINT `fk1` FOREIGN KEY');
		expect(idx((s) => s.includes('VIEW `v_base`'))).toBeLessThan(
			idx((s) => s.includes('VIEW `v_top`'))
		);
		expect(plan.find((s) => s.sql.includes('VIEW `v_top`'))!.sql).toContain('`dst`.`v_base`');
		expect(kinds.lastIndexOf('trigger')).toBe(kinds.length - 1);
		expect(kinds.indexOf('trigger')).toBeGreaterThan(kinds.lastIndexOf('data'));
		expect(plan.some((s) => s.sql.startsWith('DROP'))).toBe(false);
		expect(plan.find((s) => s.sql.startsWith('INSERT INTO `dst`.`child`'))!.sql).toBe(
			'INSERT INTO `dst`.`child` (`id`, `pid`) SELECT `id`, `pid` FROM `src`.`child`'
		);
	});

	it('copy: omits constraints, drops and database creation when not asked', () => {
		const plan = planDatabaseCopy(snap, { ...copy, createDatabase: false, constraints: false });
		expect(plan.some((s) => s.kind === 'database')).toBe(false);
		expect(plan.some((s) => s.kind === 'constraint')).toBe(false);
		const withDrop = planDatabaseCopy(snap, { ...copy, dropTable: true });
		expect(withDrop.map((s) => s.sql)).toContain('DROP TABLE IF EXISTS `dst`.`child`');
		expect(withDrop.map((s) => s.sql)).toContain('DROP VIEW IF EXISTS `v_top`');
	});

	it('structure only has no INSERT, data only has no CREATE', () => {
		const s = planDatabaseCopy(snap, { ...copy, what: 'structure' });
		expect(s.some((x) => x.kind === 'data')).toBe(false);
		const d = planDatabaseCopy(snap, { ...copy, what: 'dataonly', createDatabase: false });
		expect(d.some((x) => x.sql.startsWith('CREATE'))).toBe(false);
		expect(d.filter((x) => x.kind === 'data')).toHaveLength(2);
	});

	it('rename moves tables with checks off and re-creates triggers after the move', () => {
		const plan = planDatabaseCopy(snap, { ...copy, move: true });
		const sql = plan.map((s) => s.sql);
		expect(sql.indexOf('SET FOREIGN_KEY_CHECKS = 0')).toBeLessThan(
			sql.indexOf('RENAME TABLE `src`.`child` TO `dst`.`child`')
		);
		expect(sql).toContain('RENAME TABLE `src`.`parent` TO `dst`.`parent`');
		expect(sql.indexOf('DROP TRIGGER `src`.`trg`')).toBeLessThan(
			sql.indexOf('RENAME TABLE `src`.`parent` TO `dst`.`parent`')
		);
		expect(sql.some((s) => s.startsWith('INSERT'))).toBe(false);
		expect(sql.at(-1)).toContain('CREATE TRIGGER `trg`');
	});
});
