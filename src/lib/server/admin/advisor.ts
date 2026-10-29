/** Runs the advisor against a live server (Controllers/Server/Status/AdvisorController.php). */
import os from 'node:os';
import type { Connection } from 'mysql2/promise';
import { runAdvisor } from '#lib/advisor/engine.ts';
import type { AdvisorRunResult } from '#lib/advisor/types.ts';
import type { Translator } from '#lib/i18n/translator.ts';
import { detectServerType, versionToInt } from '#lib/server/db/dbi.ts';

type Row = Record<string, unknown>;

async function keyValue(conn: Connection, sql: string): Promise<Record<string, string>> {
	const [rows] = await conn.query(sql);
	const out: Record<string, string> = {};
	for (const r of rows as Row[]) {
		const name = r.Variable_name ?? r.variable_name;
		const value = r.Value ?? r.value;
		if (name !== undefined) out[String(name)] = value === null ? '' : String(value);
	}
	return out;
}

const LOCAL = new Set(['', 'localhost', '127.0.0.1', '::1']);

/**
 * MemTotal (KiB) of the web host. Like phpMyAdmin's SysInfo this describes the machine running the
 * app, so it is only reported when the database is local; 0 ("unknown") otherwise.
 */
export function localSystemMemoryKiB(host: string | undefined): number {
	return LOCAL.has((host ?? '').toLowerCase()) ? Math.round(os.totalmem() / 1024) : 0;
}

export async function getAdvisorResult(
	conn: Connection,
	host?: string,
	i18n?: Translator
): Promise<AdvisorRunResult> {
	const [status, variables] = await Promise.all([
		keyValue(conn, 'SHOW GLOBAL STATUS'),
		keyValue(conn, 'SHOW GLOBAL VARIABLES')
	]);
	const version = variables.version ?? '';
	const isMariaDB =
		detectServerType(version, variables.version_comment ?? '') === 'MariaDB' ||
		/mariadb/i.test(version);
	return runAdvisor({
		status,
		variables,
		versionInt: versionToInt(version),
		isMariaDB,
		systemMemory: localSystemMemoryKiB(host),
		i18n
	});
}
