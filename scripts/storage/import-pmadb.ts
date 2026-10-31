/**
 * pnpm storage:import-pmadb --server <n> --to <sqlite path> [--config <config.json>] [--user u --password p]
 *
 * Copies the `pma__*` tables of the MySQL pmadb of server <n> (1-based, as in `Servers`) into the
 * SQLite configuration storage file, under the server id `host:port` (or socket). Rows that already
 * exist in the file are replaced. The pmadb is only read.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createConnection } from 'mysql2/promise';
import { openSqlite } from '../../src/lib/server/storage/sqlite/db.ts';

interface ServerEntry {
	host?: string;
	port?: number | string;
	socket?: string;
	pmadb?: string;
	controluser?: string;
	controlpass?: string;
	controlhost?: string;
	controlport?: number | string;
	user?: string;
	password?: string;
	[key: string]: unknown;
}

/** Same rule as the app (`storageServerId`). */
export function serverId(s: Pick<ServerEntry, 'host' | 'port' | 'socket'>): string {
	if (s.socket) return `socket:${s.socket}`;
	return `${s.host || 'localhost'}:${Number(s.port) || 3306}`;
}

/** config key of the server -> SQLite table (same name as the default MySQL table). */
export const TABLES: readonly [key: string, table: string][] = [
	['bookmarktable', 'pma__bookmark'],
	['relation', 'pma__relation'],
	['table_info', 'pma__table_info'],
	['table_coords', 'pma__table_coords'],
	['pdf_pages', 'pma__pdf_pages'],
	['column_info', 'pma__column_info'],
	['history', 'pma__history'],
	['recent', 'pma__recent'],
	['favorite', 'pma__favorite'],
	['table_uiprefs', 'pma__table_uiprefs'],
	['tracking', 'pma__tracking'],
	['userconfig', 'pma__userconfig'],
	['users', 'pma__users'],
	['usergroups', 'pma__usergroups'],
	['navigationhiding', 'pma__navigationhiding'],
	['savedsearches', 'pma__savedsearches'],
	['central_columns', 'pma__central_columns'],
	['designer_settings', 'pma__designer_settings'],
	['export_templates', 'pma__export_templates']
];

const pad = (n: number) => String(n).padStart(2, '0');

/** A value read with mysql2 -> something SQLite stores (dates as `YYYY-MM-DD HH:MM:SS`). */
export function toSqliteValue(v: unknown): string | number | null {
	if (v === null || v === undefined) return null;
	if (v instanceof Date) {
		return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())} ${pad(v.getHours())}:${pad(v.getMinutes())}:${pad(v.getSeconds())}`;
	}
	if (typeof v === 'number') return v;
	if (typeof v === 'boolean') return v ? 1 : 0;
	if (typeof v === 'bigint') return Number(v);
	if (Buffer.isBuffer(v)) return v.toString('utf8');
	return String(v);
}

function option(args: string[], name: string): string | undefined {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : undefined;
}

async function main() {
	const args = process.argv.slice(2);
	const n = Number(option(args, 'server'));
	const to = option(args, 'to');
	if (!Number.isInteger(n) || n < 1 || !to) {
		console.error('usage: pnpm storage:import-pmadb --server <n> --to <sqlite path>');
		process.exit(2);
	}
	const configPath = resolve(option(args, 'config') ?? process.env.SMA_CONFIG ?? 'config.json');
	const config = JSON.parse(readFileSync(configPath, 'utf8')) as { Servers?: ServerEntry[] };
	const server = config.Servers?.[n - 1];
	if (!server?.pmadb) {
		console.error(`server ${n} has no pmadb in ${configPath}`);
		process.exit(2);
	}
	const user = option(args, 'user') ?? server.controluser ?? server.user ?? 'root';
	const password =
		option(args, 'password') ?? (server.controluser ? server.controlpass : server.password) ?? '';
	const conn = await createConnection({
		host: (server.controluser && server.controlhost) || server.host || 'localhost',
		port: Number((server.controluser && server.controlport) || server.port) || 3306,
		socketPath: server.socket || undefined,
		user,
		password,
		dateStrings: false
	});
	const id = serverId(server);
	const db = openSqlite(resolve(to));
	try {
		for (const [key, table] of TABLES) {
			const name = String(server[key] ?? '');
			if (!name) continue;
			let rows: Record<string, unknown>[];
			try {
				[rows] = (await conn.query(
					`SELECT * FROM \`${server.pmadb.replaceAll('`', '``')}\`.\`${name.replaceAll('`', '``')}\``
				)) as unknown as [Record<string, unknown>[]];
			} catch (e) {
				console.warn(`skip ${name}: ${(e as Error).message}`);
				continue;
			}
			db.exec('BEGIN IMMEDIATE');
			try {
				for (const row of rows) {
					const cols = Object.keys(row);
					const quoted = cols.map((c) => `"${c.replaceAll('"', '""')}"`).join(', ');
					db.prepare(
						`INSERT OR REPLACE INTO ${table} (server, ${quoted}) VALUES (?${', ?'.repeat(cols.length)})`
					).run(id, ...cols.map((c) => toSqliteValue(row[c])));
				}
				db.exec('COMMIT');
			} catch (e) {
				db.exec('ROLLBACK');
				throw e;
			}
			console.log(`${table}: ${rows.length} row(s)`);
		}
	} finally {
		await conn.end();
		db.close();
	}
	console.log(`imported the pmadb of server ${n} (${id}) into ${resolve(to)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
	await main();
}
