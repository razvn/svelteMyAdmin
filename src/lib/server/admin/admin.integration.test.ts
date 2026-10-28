import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '#lib/server/db/connection.ts';
import { DatabaseInterface, type ServerInfo } from '#lib/server/db/dbi.ts';
import { buildVariables } from '#lib/admin/status-vars.ts';
import { queryStats, usedQueries } from '#lib/admin/queries.ts';
import { getBinlogEvents, isBinlogEnabled, listBinlogs } from './binlog.ts';
import { connectionId, killProcess, listProcesses } from './processes.ts';
import { getReplication } from './replication.ts';
import { getStatusData, summarize } from './status.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306, type: 'MySQL' },
	{ name: 'mariadb 11.4', port: 33307, type: 'MariaDB' }
];

const opts = {
	host: '127.0.0.1',
	socket: '',
	ssl: false,
	ssl_ca: null,
	ssl_cert: null,
	ssl_key: null,
	ssl_ciphers: null,
	ssl_verify: true,
	compress: false
};

for (const { name, port, type } of servers) {
	describe(`admin data against ${name}`, () => {
		let conn: Connection | undefined;
		let other: Connection | undefined;
		let info: ServerInfo;

		beforeAll(async () => {
			try {
				conn = await createConnection({ ...opts, port }, 'root', 'root');
				other = await createConnection({ ...opts, port }, 'root', 'root');
				info = await new DatabaseInterface(conn, {
					only_db: '',
					hide_db: '',
					host: '127.0.0.1',
					port
				}).getServerInfo();
			} catch {
				console.warn(`[integration] ${name} unreachable, skipping`);
				conn = undefined;
			}
		});
		afterAll(async () => {
			await conn?.end();
			await other?.end().catch(() => {});
		});

		it('status data, summary, variables and query stats', async ({ skip }) => {
			if (!conn) return skip();
			expect(info.serverType).toBe(type);
			const { status, variables } = await getStatusData(conn);
			expect(Number(status.Uptime)).toBeGreaterThan(0);
			expect(variables.version).toBeTruthy();
			const s = summarize(status);
			expect(s.uptime).toBeGreaterThan(0);
			expect(s.bytesReceived).toBeGreaterThan(0);
			const vars = buildVariables(status, variables, {});
			expect(vars.some((v) => v.name === 'Uptime' && v.section === 'other')).toBe(true);
			const stats = queryStats(usedQueries(status), s.uptime);
			expect(stats.total).toBeGreaterThan(0);
			expect(stats.queries.some((q) => q.name === 'show status')).toBe(true);
		});

		it('lists processes including our own', async ({ skip }) => {
			if (!conn) return skip();
			const id = await connectionId(conn);
			const list = await listProcesses(conn);
			const mine = list.find((p) => p.id === id);
			expect(mine?.user).toBe('root');
			expect(mine?.info).toContain('PROCESSLIST');
		});

		it('kills a second connection, refuses own and invalid ids', async ({ skip }) => {
			if (!conn || !other) return skip();
			const victim = await connectionId(other);
			expect(await listProcesses(conn)).toEqual(
				expect.arrayContaining([expect.objectContaining({ id: victim, command: 'Sleep' })])
			);
			expect(await killProcess(conn, String(victim))).toEqual({ ok: true });
			await expect(other.query('SELECT 1')).rejects.toBeTruthy();
			expect(await killProcess(conn, await connectionId(conn))).toMatchObject({
				ok: false,
				reason: 'own'
			});
			expect(await killProcess(conn, '1; SELECT 1')).toMatchObject({
				ok: false,
				reason: 'invalid'
			});
			expect(await killProcess(conn, '999999999')).toMatchObject({ ok: false, reason: 'error' });
		});

		it('replication overview does not throw', async ({ skip }) => {
			if (!conn) return skip();
			const r = await getReplication(conn, info);
			expect(r.replicas).toEqual([]);
			expect(r.errors).toEqual([]);
			expect(r.statements.primary).toMatch(/^SHOW (MASTER|BINARY LOG) STATUS$/);
			if (r.primary) expect(r.primary.File).toBeTruthy();
		});

		it('binary logs', async ({ skip }) => {
			if (!conn) return skip();
			const enabled = await isBinlogEnabled(conn);
			const files = await listBinlogs(conn);
			if (!enabled) {
				expect(files).toEqual([]);
				return;
			}
			expect(files.length).toBeGreaterThan(0);
			const page = await getBinlogEvents(conn, files[0].name, 0, 3);
			expect(page.events.length).toBeGreaterThan(0);
			expect(page.events.length).toBeLessThanOrEqual(3);
			expect(page.events[0].eventType).toBeTruthy();
			const next = await getBinlogEvents(conn, files[0].name, 3, 3);
			if (next.events.length) expect(next.events[0].pos).toBeGreaterThan(page.events[0].pos);
		});
	});
}
