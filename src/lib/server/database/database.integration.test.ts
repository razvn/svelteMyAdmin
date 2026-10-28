import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '../db/connection';
import type { RoutineDef } from '#lib/sql/routine.ts';
import type { EventDef } from '#lib/sql/event.ts';
import {
	dropRoutine,
	executeRoutine,
	exportRoutine,
	getRoutine,
	listRoutines,
	saveRoutine
} from './routines';
import {
	dropEvent,
	exportEvent,
	getEvent,
	getSchedulerState,
	listEvents,
	saveEvent
} from './events';
import { dropTrigger, exportTrigger, getTrigger, listTriggers, saveTrigger } from './triggers';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

const procDef = (over: Partial<RoutineDef> = {}): RoutineDef => ({
	type: 'PROCEDURE',
	name: 'p_add',
	definer: '',
	params: [
		{ direction: 'IN', name: 'a', type: 'INT', length: '', opts: '' },
		{ direction: 'INOUT', name: 'b', type: 'INT', length: '', opts: '' },
		{ direction: 'OUT', name: 'c', type: 'VARCHAR', length: '20', opts: 'utf8mb4' }
	],
	returns: { type: 'INT', length: '', opts: '' },
	definition: "BEGIN SET b = b + a; SET c = CONCAT('sum=', b); SELECT a AS first, b AS second; END",
	deterministic: false,
	securityType: 'INVOKER',
	sqlDataAccess: 'CONTAINS SQL',
	comment: 'adds',
	...over
});

for (const { name, port } of servers) {
	describe(`database routines/events/triggers against ${name}`, () => {
		let conn: Connection | undefined;
		const db = `tmp_t3d_int_${port}`;

		beforeAll(async () => {
			try {
				conn = await createConnection(
					{
						host: '127.0.0.1',
						port,
						socket: '',
						ssl: false,
						ssl_ca: null,
						ssl_cert: null,
						ssl_key: null,
						ssl_ciphers: null,
						ssl_verify: true,
						compress: false
					},
					'root',
					'root'
				);
				await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
				await conn.query(`CREATE DATABASE \`${db}\``);
				await conn.query(`CREATE TABLE \`${db}\`.t (id INT PRIMARY KEY, v INT)`);
			} catch {
				conn = undefined;
				console.warn(`[integration] ${name} unreachable on 127.0.0.1:${port}, skipping`);
			}
		});
		afterAll(async () => {
			await conn?.query(`DROP DATABASE IF EXISTS \`${db}\``);
			await conn?.end();
		});

		it('creates, reads back, executes, edits and drops a procedure', async ({ skip }) => {
			if (!conn) return skip();
			const created = await saveRoutine(conn, db, procDef(), null);
			expect(created.errors).toEqual([]);
			expect(created.ok).toBe(true);

			const list = await listRoutines(conn, db);
			expect(list.map((r) => [r.name, r.type, r.securityType])).toEqual([
				['p_add', 'PROCEDURE', 'INVOKER']
			]);

			const loaded = await getRoutine(conn, db, 'PROCEDURE', 'p_add');
			// MariaDB reports int(11): ignore the display width of INT
			expect(
				loaded?.params.map((p) => [p.direction, p.name, p.type, p.type === 'INT' ? '' : p.length])
			).toEqual([
				['IN', 'a', 'INT', ''],
				['INOUT', 'b', 'INT', ''],
				['OUT', 'c', 'VARCHAR', '20']
			]);
			expect(loaded?.comment).toBe('adds');
			expect(loaded?.sqlDataAccess).toBe('CONTAINS SQL');
			expect(loaded?.definition).toContain('SET b = b + a');

			const run = await executeRoutine(conn, db, 'PROCEDURE', 'p_add', [
				{ direction: 'IN', name: 'a', type: 'INT', value: '3', isNull: false },
				{ direction: 'INOUT', name: 'b', type: 'INT', value: '4', isNull: false },
				{ direction: 'OUT', name: 'c', type: 'VARCHAR', value: '', isNull: false }
			]);
			expect(run.error).toBeUndefined();
			expect(run.resultSets).toEqual([{ columns: ['first', 'second'], rows: [['3', '7']] }]);
			expect(run.outParams).toEqual([
				{ name: 'b', value: '7' },
				{ name: 'c', value: 'sum=7' }
			]);

			// the exported statement mentions the routine
			expect(await exportRoutine(conn, db, 'PROCEDURE', 'p_add')).toContain('p_add');

			// edit: rename + change body
			const edited = await saveRoutine(
				conn,
				db,
				procDef({ name: 'p_add2', definition: 'SELECT 42 AS answer', params: [] }),
				{ type: 'PROCEDURE', name: 'p_add' }
			);
			expect(edited.errors).toEqual([]);
			expect((await listRoutines(conn, db)).map((r) => r.name)).toEqual(['p_add2']);
			const run2 = await executeRoutine(conn, db, 'PROCEDURE', 'p_add2', []);
			expect(run2.resultSets[0].rows).toEqual([['42']]);

			// failing edit rolls back to the original
			const bad = await saveRoutine(
				conn,
				db,
				procDef({ name: 'p_add2', definition: 'SELECT nope_col FROM nope_table; SYNTAX ERROR(' }),
				{ type: 'PROCEDURE', name: 'p_add2' }
			);
			expect(bad.ok).toBe(false);
			expect(bad.rolledBack).toBe(true);
			expect((await listRoutines(conn, db)).map((r) => r.name)).toEqual(['p_add2']);

			expect((await dropRoutine(conn, db, 'PROCEDURE', 'p_add2')).ok).toBe(true);
			expect(await listRoutines(conn, db)).toEqual([]);
			expect((await dropRoutine(conn, db, 'PROCEDURE', 'p_add2')).ok).toBe(false);
		});

		it('creates and executes a function', async ({ skip }) => {
			if (!conn) return skip();
			const def: RoutineDef = {
				type: 'FUNCTION',
				name: 'f_greet',
				definer: 'root@%',
				params: [{ direction: 'IN', name: 'who', type: 'VARCHAR', length: '10', opts: 'utf8mb4' }],
				returns: { type: 'VARCHAR', length: '30', opts: 'utf8mb4' },
				definition: "RETURN CONCAT('hi ', who)",
				deterministic: true,
				securityType: 'DEFINER',
				sqlDataAccess: 'NO SQL',
				comment: ''
			};
			const saved = await saveRoutine(conn, db, def, null);
			expect(saved.errors).toEqual([]);
			const loaded = await getRoutine(conn, db, 'FUNCTION', 'f_greet');
			expect(loaded?.returns).toMatchObject({ type: 'VARCHAR', length: '30' });
			expect(loaded?.params[0]).toMatchObject({ direction: 'IN', name: 'who', type: 'VARCHAR' });
			expect(loaded?.deterministic).toBe(true);
			expect(loaded?.definer).toBe('root@%');
			const run = await executeRoutine(conn, db, 'FUNCTION', 'f_greet', [
				{ direction: 'IN', name: 'who', type: 'VARCHAR', value: "o'neil", isNull: false }
			]);
			expect(run.resultSets[0].rows).toEqual([["hi o'neil"]]);
			expect((await dropRoutine(conn, db, 'FUNCTION', 'f_greet')).ok).toBe(true);
		});

		it('creates, edits and drops an event', async ({ skip }) => {
			if (!conn) return skip();
			const ev: EventDef = {
				name: 'ev1',
				status: 'DISABLED',
				type: 'RECURRING',
				executeAt: '',
				intervalValue: '1',
				intervalField: 'DAY',
				starts: '2031-01-01 00:00:00',
				ends: '',
				definition: 'DELETE FROM t WHERE id < 0',
				preserve: true,
				definer: '',
				comment: 'nightly'
			};
			const saved = await saveEvent(conn, db, ev, null);
			expect(saved.errors).toEqual([]);
			const list = await listEvents(conn, db);
			expect(list).toHaveLength(1);
			expect(list[0]).toMatchObject({
				name: 'ev1',
				status: 'DISABLED',
				type: 'RECURRING',
				intervalValue: '1',
				intervalField: 'DAY',
				starts: '2031-01-01 00:00:00'
			});
			const loaded = await getEvent(conn, db, 'ev1');
			expect(loaded).toMatchObject({ preserve: true, comment: 'nightly', status: 'DISABLED' });

			const edited = await saveEvent(
				conn,
				db,
				{
					...ev,
					name: 'ev2',
					type: 'ONE TIME',
					executeAt: '2031-02-02 10:00:00',
					preserve: false
				},
				'ev1'
			);
			expect(edited.errors).toEqual([]);
			const after = await listEvents(conn, db);
			expect(after.map((e) => [e.name, e.type, e.executeAt])).toEqual([
				['ev2', 'ONE TIME', '2031-02-02 10:00:00']
			]);
			expect(await exportEvent(conn, db, 'ev2')).toContain('ev2');
			expect((await dropEvent(conn, db, 'ev2')).ok).toBe(true);

			const sched = await getSchedulerState(conn);
			expect(['ON', 'OFF', 'DISABLED']).toContain(sched.state);
			expect(sched.canToggle).toBe(true);
		});

		it('creates, filters by table, edits and drops a trigger', async ({ skip }) => {
			if (!conn) return skip();
			await conn.query(`CREATE TABLE \`${db}\`.t2 (id INT)`);
			const saved = await saveTrigger(
				conn,
				db,
				{
					name: 'trg_before',
					table: 't',
					timing: 'BEFORE',
					event: 'INSERT',
					definition: 'SET NEW.v = IFNULL(NEW.v, 0) + 1',
					definer: ''
				},
				null
			);
			expect(saved.errors).toEqual([]);
			await conn.query(`INSERT INTO \`${db}\`.t (id, v) VALUES (1, 10)`);
			const [r] = (await conn.query(`SELECT v FROM \`${db}\`.t WHERE id = 1`)) as [
				{ v: number }[],
				unknown
			];
			expect(r[0].v).toBe(11);

			expect((await listTriggers(conn, db)).map((x) => x.name)).toEqual(['trg_before']);
			expect(await listTriggers(conn, db, 't2')).toEqual([]);
			const loaded = await getTrigger(conn, db, 'trg_before', 't');
			expect(loaded).toMatchObject({ table: 't', timing: 'BEFORE', event: 'INSERT' });
			expect(loaded?.definition).toContain('NEW.v');
			expect(await getTrigger(conn, db, 'trg_before', 't2')).toBeNull();

			const edited = await saveTrigger(
				conn,
				db,
				{
					...loaded!,
					name: 'trg_after',
					timing: 'AFTER',
					event: 'UPDATE',
					definition: 'SET @x = 1'
				},
				'trg_before'
			);
			expect(edited.errors).toEqual([]);
			expect((await listTriggers(conn, db, 't')).map((x) => [x.name, x.timing, x.event])).toEqual([
				['trg_after', 'AFTER', 'UPDATE']
			]);
			expect(await exportTrigger(conn, db, 'trg_after')).toContain('trg_after');
			expect((await dropTrigger(conn, db, 'trg_after')).ok).toBe(true);
			expect(await listTriggers(conn, db)).toEqual([]);
		});
	});
}
