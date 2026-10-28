/** Helpers shared by the export integration tests (not production code). */
import { createConnection, type Connection } from '#lib/server/db/connection.ts';
import { getExportPlugin } from './registry.ts';
import { driveExport, type ExportEnv, type ExportRequest } from './run.ts';
import type { ExportOptionValues } from './types.ts';

export const SERVERS = [
	{ name: 'mysql', label: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb', label: 'mariadb 11.4', port: 33307 }
];

export async function connect(port: number): Promise<Connection | undefined> {
	try {
		return await createConnection(
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
		console.warn(`[integration] 127.0.0.1:${port} unreachable, skipping`);
		return undefined;
	}
}

export async function envFor(conn: Connection, port: number, asFile = true): Promise<ExportEnv> {
	const [r] = await conn.query('SELECT VERSION() AS v');
	const version = String((r as { v: string }[])[0].v);
	return {
		conn,
		server: { version, isMariaDb: /mariadb/i.test(version), host: `127.0.0.1:${port}` },
		appVersion: '0.0.1',
		now: new Date(2026, 0, 2, 3, 4, 5),
		asFile
	};
}

export function defaultOptions(id: string): ExportOptionValues {
	const plugin = getExportPlugin(id)!;
	return Object.fromEntries(plugin.options.map((o) => [o.name, o.default]));
}

/** Run a plugin export into a string. */
export async function exportString(
	env: ExportEnv,
	req: Omit<ExportRequest, 'plugin' | 'options'> & {
		format?: string;
		options?: ExportOptionValues;
	}
): Promise<string> {
	const id = req.format ?? 'sql';
	const plugin = getExportPlugin(id)!;
	let out = '';
	await driveExport(env, { ...req, plugin, options: { ...defaultOptions(id), ...req.options } }, async (c) => {
		out += typeof c === 'string' ? c : Buffer.from(c).toString('utf8');
	});
	return out;
}

/** Stable text for golden comparison: version/host/time lines and datetime literals. */
export function normalize(sql: string): string {
	return sql
		.replace(/^-- (Host|Generation Time|Server version|Node\.js Version): .*$/gm, '-- $1: <$1>')
		.replace(/'\d{4}-\d\d-\d\d \d\d:\d\d:\d\d(\.\d+)?'/g, (m) =>
			m.includes('00:00:00') || m.includes('.') ? m : "'<DATETIME>'"
		);
}
