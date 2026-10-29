import { describe, expect, it } from 'vitest';
import {
	defaultCreateStatements,
	featureStatuses,
	missingTableStatements,
	PMA_FEATURES
} from './features.ts';

const names = Object.fromEntries(PMA_FEATURES.map((f) => [f.key, f.table]));
const all = new Set(PMA_FEATURES.map((f) => f.table));

describe('storage feature map', () => {
	it('knows the 19 phpMyAdmin tables', () => {
		expect(PMA_FEATURES).toHaveLength(19);
		expect(new Set(PMA_FEATURES.map((f) => f.key)).size).toBe(19);
	});

	it('every feature has a CREATE TABLE in the bundled create_tables.sql', () => {
		const ddl = defaultCreateStatements();
		for (const f of PMA_FEATURES) expect(ddl.has(f.table), f.table).toBe(true);
		expect(ddl.size).toBe(19);
	});

	it('is all OK when every configured table exists', () => {
		const s = featureStatuses({ pmadb: 'phpmyadmin', ...names }, all);
		expect(s.allWorks).toBe(true);
		expect(s.missing).toBe(0);
		expect(s.reachable).toBe(true);
	});

	it('flags missing and unconfigured tables', () => {
		const partial = new Set(all);
		partial.delete('pma__recent');
		const s = featureStatuses({ pmadb: 'phpmyadmin', ...names, favorite: '' }, partial);
		expect(s.allWorks).toBe(false);
		expect(s.features.find((f) => f.key === 'recent')).toMatchObject({
			configured: true,
			exists: false,
			ok: false
		});
		expect(s.features.find((f) => f.key === 'favorite')).toMatchObject({
			configured: false,
			ok: false
		});
		expect(s.missing).toBe(2);
	});

	it('is not configured without pmadb, and unreachable when the tables cannot be listed', () => {
		const none = featureStatuses({ ...names }, all);
		expect(none).toMatchObject({ configured: false, allWorks: false, pmadb: 'phpmyadmin' });
		const down = featureStatuses({ pmadb: 'x', ...names }, null);
		expect(down).toMatchObject({ configured: true, reachable: false, allWorks: false });
	});
});

describe('missing table statements', () => {
	it('qualifies the table with the target database and keeps the verbatim DDL', () => {
		const todo = missingTableStatements('tmp_t8a_pma', { ...names }, new Set(['pma__bookmark']));
		expect(todo).toHaveLength(18);
		const recent = todo.find((t) => t.table === 'pma__recent')!;
		expect(recent.statement).toMatch(/^CREATE TABLE IF NOT EXISTS `tmp_t8a_pma`\.`pma__recent` \(/);
		expect(recent.statement).toContain('`tables` text NOT NULL');
		expect(recent.statement).toContain('DEFAULT CHARACTER SET utf8 COLLATE utf8_bin');
	});

	it('uses custom table names', () => {
		const todo = missingTableStatements('db', { ...names, recent: 'my_recent' }, new Set());
		expect(todo.find((t) => t.table === 'my_recent')?.statement).toContain('`db`.`my_recent`');
	});
});
