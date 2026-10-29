import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '#lib/server/db/connection.ts';
import { chartValues, parseSample, requiredPoints } from '#lib/monitor/math.ts';
import { defaultCharts, PRESETS, chartFromPreset } from '#lib/monitor/presets.ts';
import { getAdvisorResult } from './advisor.ts';
import {
	analyzeQuery,
	getChartingData,
	getGeneralLog,
	getLoggingVars,
	getSlowLog,
	setLoggingVar,
	type LoggingVar
} from './monitor.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306, mariadb: false },
	{ name: 'mariadb 11.4', port: 33307, mariadb: true }
];

for (const { name, port, mariadb } of servers) {
	describe(`monitor and advisor against ${name}`, () => {
		let conn: Connection | undefined;

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
			} catch {
				console.warn(`[integration] ${name} unreachable on 127.0.0.1:${port}, skipping`);
			}
		});
		afterAll(async () => {
			await conn?.end();
		});

		it('charting data returns numbers for every default chart point', async ({ skip }) => {
			if (!conn) return skip();
			const charts = defaultCharts();
			const first = await getChartingData(conn, requiredPoints(charts) as never);
			expect(first.x).toBeGreaterThan(1_600_000_000_000);
			const raw1 = parseSample(first.values);
			for (const [k, v] of Object.entries(raw1)) {
				expect(typeof v === 'number', `${k} should be numeric, got ${String(v)}`).toBe(true);
			}
			await conn.query('SELECT 1');
			const second = await getChartingData(conn, requiredPoints(charts) as never);
			const raw2 = parseSample(second.values);
			const q = charts[0];
			const [v] = chartValues(q, raw1, raw2, Math.max(0.001, (second.x - first.x) / 1000));
			expect(v).not.toBeNull();
			expect(v!).toBeGreaterThanOrEqual(0);
		});

		it('missing variables come back as null and server variables work', async ({ skip }) => {
			if (!conn) return skip();
			const r = await getChartingData(conn, [
				{ type: 'statusvar', name: 'No_such_status' },
				{ type: 'servervar', name: 'max_connections' }
			]);
			expect(r.values['statusvar:No_such_status']).toBeNull();
			expect(Number(r.values['servervar:max_connections'])).toBeGreaterThan(0);
		});

		it('every preset chart can be sampled without errors', async ({ skip }) => {
			if (!conn) return skip();
			const charts = PRESETS.map((p) => chartFromPreset(p.key, p.key)!);
			const r = await getChartingData(conn, requiredPoints(charts) as never);
			expect(Object.keys(r.values).length).toBeGreaterThan(10);
		});

		it('reads slow and general log tables after enabling them, then restores the settings', async ({
			skip
		}) => {
			if (!conn) return skip();
			const names: LoggingVar[] = [
				'general_log',
				'slow_query_log',
				'long_query_time',
				'log_output'
			];
			const original = await getLoggingVars(conn);
			const [[sessionRow]] = (await conn.query('SELECT @@session.long_query_time AS v')) as [
				{ v: unknown }[],
				unknown
			];
			const marker = `tmp_t9b_marker_${port}_${Date.now()}`;
			try {
				await setLoggingVar(conn, 'log_output', 'TABLE');
				await setLoggingVar(conn, 'long_query_time', '0');
				await conn.query('SET SESSION long_query_time = 0');
				await setLoggingVar(conn, 'slow_query_log', 'ON');
				await setLoggingVar(conn, 'general_log', 'ON');
				// MariaDB copies these into the session when a connection opens.
				for (const v of ['slow_query_log', 'general_log']) {
					await conn.query(`SET SESSION ${v} = 1`).catch(() => undefined);
				}
				const start = Math.floor(Date.now() / 1000) - 2;
				await conn.query(`SELECT '${marker}' AS m, SLEEP(0.05)`);
				await conn.query(`SELECT '${marker}' AS m, SLEEP(0.05)`);
				const end = Math.ceil(Date.now() / 1000) + 2;

				const slow = await getSlowLog(conn, start, end);
				const hit = slow.rows.filter((r) => r.sql_text.includes(marker));
				expect(hit.length).toBeGreaterThan(0);
				expect(hit.reduce((n, r) => n + r.count, 0)).toBe(2);
				expect(slow.sum.select).toBeGreaterThanOrEqual(2);
				expect(slow.sum.TOTAL).toBeGreaterThanOrEqual(2);

				const general = await getGeneralLog(conn, start, end, true, false);
				const g = general.rows.filter((r) => r.argument.includes(marker));
				expect(g.reduce((n, r) => n + r.count, 0)).toBe(2);
				expect(general.sum.select).toBeGreaterThanOrEqual(2);
			} finally {
				await conn.query('SET SESSION long_query_time = ?', [Number(sessionRow.v)]);
				// Restore in dependency order: switch the logs off before changing log_output.
				await setLoggingVar(conn, 'slow_query_log', original.slow_query_log);
				await setLoggingVar(conn, 'general_log', original.general_log);
				await setLoggingVar(conn, 'long_query_time', original.long_query_time);
				await setLoggingVar(conn, 'log_output', original.log_output);
			}
			const after = await getLoggingVars(conn);
			for (const n of names) {
				if (n === 'long_query_time') {
					expect(Number(after[n])).toBe(Number(original[n]));
				} else {
					expect(after[n].toUpperCase()).toBe(original[n].toUpperCase());
				}
			}
		});

		it('rejects invalid logging values', async ({ skip }) => {
			if (!conn) return skip();
			await expect(setLoggingVar(conn, 'log_output', 'TABLE; DROP')).rejects.toThrow();
			await expect(setLoggingVar(conn, 'slow_query_log', 'maybe')).rejects.toThrow();
			await expect(setLoggingVar(conn, 'long_query_time', '-1')).rejects.toThrow();
		});

		it('analyses a SELECT (explain) and only explains other statements', async ({ skip }) => {
			if (!conn) return skip();
			const sel = await analyzeQuery(conn, 'information_schema', 'SELECT * FROM TABLES LIMIT 1');
			expect(sel.error).toBeNull();
			expect(sel.executed).toBe(true);
			expect(sel.explain?.length).toBeGreaterThan(0);
			const upd = await analyzeQuery(conn, '', 'DELETE FROM nonexistent_tmp_t9b WHERE id = 1');
			expect(upd.executed).toBe(false);
			expect(upd.error).toBeTruthy();
			const bad = await analyzeQuery(conn, '', 'SELECT FROM WHERE');
			expect(bad.error).toBeTruthy();
		});

		it('the advisor runs on the live server with no evaluation errors', async ({ skip }) => {
			if (!conn) return skip();
			const r = await getAdvisorResult(conn, '127.0.0.1');
			// Only variables that a given server genuinely lacks may be reported; log them for visibility.
			expect(r.errors, r.errors.join('\n')).toEqual([]);
			expect(r.fired.length + r.notfired.length + r.unchecked.length).toBeGreaterThan(40);
			if (mariadb) {
				expect(
					[...r.fired, ...r.notfired, ...r.unchecked].some((x) => x.id === 'Query cache disabled')
				).toBe(true);
			}
			for (const rule of r.fired) {
				expect(rule.justification).not.toMatch(/%[sd]/);
			}
		});
	});
}
