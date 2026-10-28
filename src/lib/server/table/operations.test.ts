import { describe, expect, it } from 'vitest';
import { planTableCopy, type TableCopySource } from './operations';

const src: TableCopySource = {
	db: 'a',
	table: 'child',
	createSql: [
		'CREATE TABLE `child` (',
		'  `id` int NOT NULL AUTO_INCREMENT,',
		'  `pid` int DEFAULT NULL,',
		'  PRIMARY KEY (`id`),',
		'  KEY `fk1` (`pid`),',
		'  CONSTRAINT `fk1` FOREIGN KEY (`pid`) REFERENCES `parent` (`id`)',
		') ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4'
	].join('\n'),
	columns: ['id', 'pid'],
	triggers: [
		{
			name: 'trg',
			createSql: 'CREATE TRIGGER `trg` BEFORE INSERT ON `child` FOR EACH ROW SET NEW.pid = 1'
		}
	]
};
const opts = {
	targetDb: 'b',
	targetTable: 'kid',
	what: 'data' as const,
	dropTable: false,
	autoIncrement: false,
	constraints: true
};

describe('planTableCopy', () => {
	it('copies into another db: rename, data, named constraint, re-targeted trigger last', () => {
		const sql = planTableCopy(src, opts).map((s) => s.sql);
		expect(sql[0]).toBe('SET FOREIGN_KEY_CHECKS = 0');
		expect(sql.find((s) => s.startsWith('CREATE TABLE'))).toContain('CREATE TABLE `b`.`kid` (');
		expect(sql.find((s) => s.startsWith('CREATE TABLE'))).not.toContain('AUTO_INCREMENT=9');
		expect(sql).toContain(
			'INSERT INTO `b`.`kid` (`id`, `pid`) SELECT `id`, `pid` FROM `a`.`child`'
		);
		expect(sql.find((s) => s.startsWith('ALTER TABLE'))).toContain(
			'ADD CONSTRAINT `fk1` FOREIGN KEY'
		);
		expect(sql.at(-2)).toBe('USE `b`');
		expect(sql.at(-1)).toContain('ON `kid` FOR EACH ROW');
	});
	it('within one db: no trigger, server-named constraints, DROP TABLE on request', () => {
		const sql = planTableCopy(src, { ...opts, targetDb: 'a', dropTable: true }).map((s) => s.sql);
		expect(sql.some((s) => s.includes('TRIGGER'))).toBe(false);
		expect(sql).toContain('DROP TABLE IF EXISTS `a`.`kid`');
		expect(sql.find((s) => s.startsWith('ALTER TABLE'))).toContain('ADD FOREIGN KEY');
	});
	it('structure only has no data, data only no structure', () => {
		const s1 = planTableCopy(src, { ...opts, what: 'structure' }).map((s) => s.sql);
		expect(s1.some((s) => s.startsWith('INSERT'))).toBe(false);
		const s2 = planTableCopy(src, { ...opts, what: 'dataonly' }).map((s) => s.sql);
		expect(s2.some((s) => s.startsWith('CREATE'))).toBe(false);
		expect(s2.some((s) => s.startsWith('INSERT'))).toBe(true);
	});
	it('keeps AUTO_INCREMENT on request', () => {
		const sql = planTableCopy(src, { ...opts, autoIncrement: true }).map((s) => s.sql);
		expect(sql.find((s) => s.startsWith('CREATE TABLE'))).toContain('AUTO_INCREMENT=9');
	});
});
