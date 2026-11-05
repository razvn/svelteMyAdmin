import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { serverSchema } from '#lib/server/config/schema.ts';
import { createConnection, type Connection } from '#lib/server/db/connection.ts';
import { escapeQualified } from '#lib/server/db/escape.ts';
import { installTracking } from '#lib/server/pmadb/tracking-hook.ts';
import { createVersion, getTrackedData, type TrackingCtx } from '#lib/server/pmadb/tracking.ts';
import { connectionRunner } from '#lib/server/storage/mysql/runner.ts';
import { trackingRepo } from '#lib/server/storage/mysql/tracking.ts';
import type { AuditBody } from './index.ts';
import { installAudit } from './statements.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

for (const { name, port } of servers) {
	describe(`audit log against ${name}`, () => {
		let conn: Connection | undefined;
		const db = `tmp_audit_int_${port}`;
		const tracking = escapeQualified('phpmyadmin', 'pma__tracking');
		// No control user: tracking writes pma__tracking through the user's own connection.
		const server = serverSchema.parse({ pmadb: 'phpmyadmin', tracking: 'pma__tracking' });
		const ctx = (c: Connection): TrackingCtx => ({
			repo: trackingRepo(connectionRunner(c), tracking),
			user: 'alice',
			server
		});

		const cleanup = async () => {
			if (!conn) return;
			await conn.query(`DELETE FROM ${tracking} WHERE db_name = ?`, [db]);
			await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
		};

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
				await conn.query(`SELECT 1 FROM ${tracking} LIMIT 1`);
				await cleanup();
				await conn.query(`CREATE DATABASE \`${db}\``);
			} catch {
				conn = undefined;
				console.warn(`[integration] ${name} or its pmadb unreachable, skipping`);
			}
		});
		afterAll(async () => {
			await cleanup();
			await conn?.end();
		});

		for (const order of ['tracking first', 'audit first'] as const) {
			it(`audits each user write once and none of tracking's own queries (${order})`, async (t) => {
				if (!conn) return t.skip();
				const c = conn;
				const table = order === 'tracking first' ? 't1' : 't2';
				await c.query(`CREATE TABLE \`${db}\`.\`${table}\` (id INT PRIMARY KEY)`);
				await createVersion(ctx(c), c, { db, table, version: 1 });

				const events: AuditBody[] = [];
				const audit = () =>
					installAudit(c, { write: (e) => events.push(e) }, { includeValues: true });
				const track = () => installTracking(c, server, 'alice');
				let undoAudit: () => void;
				let hook: ReturnType<typeof installTracking>;
				if (order === 'tracking first') {
					hook = track();
					undoAudit = audit();
				} else {
					undoAudit = audit();
					hook = track();
				}
				try {
					await c.query(`USE \`${db}\``);
					await c.query(`INSERT INTO \`${table}\` (id) VALUES (?)`, [1]);
					await expect(c.query(`INSERT INTO \`${table}\` (id) VALUES (1)`)).rejects.toThrow();
					await c.query(`SELECT * FROM \`${table}\``);
				} finally {
					if (order === 'tracking first') {
						undoAudit();
						await hook?.close();
					} else {
						await hook?.close();
						undoAudit();
					}
				}

				expect(events).toEqual([
					{
						event: 'statement',
						db,
						sql: `INSERT INTO \`${table}\` (id) VALUES (1)`,
						ok: true,
						affectedRows: 1
					},
					{
						event: 'statement',
						db,
						sql: `INSERT INTO \`${table}\` (id) VALUES (1)`,
						ok: false,
						errorCode: 'ER_DUP_ENTRY'
					}
				]);
				// tracking still recorded the successful statement (through its own, unaudited queries)
				const data = await getTrackedData(ctx(c), db, table, 1);
				expect(data!.dmlog.map((e) => e.statement)).toEqual([
					`INSERT INTO \`${table}\` (id) VALUES (1);`
				]);
			});
		}
	});
}
