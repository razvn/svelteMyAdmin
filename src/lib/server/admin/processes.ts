/** Process list and KILL (libraries/classes/Server/Status/Processes.php). */
import { SOURCE_TRANSLATOR, type Translator } from '#lib/i18n/translator.ts';
import type { Connection } from 'mysql2/promise';

export interface ProcessRow {
	id: number;
	user: string;
	host: string;
	db: string | null;
	command: string;
	time: number;
	state: string;
	info: string | null;
	/** MariaDB only. */
	progress: number | null;
}

/** Cap on the SQL text sent to the browser. */
const MAX_INFO = 100_000;

type Row = Record<string, unknown>;

export function mapProcessRow(r: Row): ProcessRow {
	const info = r.Info === null || r.Info === undefined ? null : String(r.Info);
	return {
		id: Number(r.Id),
		user: String(r.User ?? ''),
		host: String(r.Host ?? ''),
		db: r.db === null || r.db === undefined ? null : String(r.db),
		command: String(r.Command ?? ''),
		time: Number(r.Time ?? 0),
		state: r.State === null || r.State === undefined ? '' : String(r.State),
		info: info === null ? null : info.slice(0, MAX_INFO),
		progress: r.Progress === null || r.Progress === undefined ? null : Number(r.Progress)
	};
}

/** SHOW FULL PROCESSLIST sorted by id. */
export async function listProcesses(conn: Connection): Promise<ProcessRow[]> {
	const [rows] = await conn.query('SHOW FULL PROCESSLIST');
	return (rows as Row[]).map(mapProcessRow).sort((a, b) => a.id - b.id);
}

export async function connectionId(conn: Connection): Promise<number> {
	const [rows] = await conn.query('SELECT CONNECTION_ID() AS id');
	return Number((rows as Row[])[0].id);
}

/** Parse a process id: a positive safe integer, nothing else. */
export function parseProcessId(value: unknown): number | null {
	const s = typeof value === 'number' ? String(value) : value;
	if (typeof s !== 'string' || !/^\d{1,15}$/.test(s)) return null;
	const n = Number(s);
	return n > 0 ? n : null;
}

export type KillResult =
	{ ok: true } | { ok: false; reason: 'invalid' | 'own' | 'error'; message: string };

/** KILL <id>. Refuses invalid ids and the connection that runs the request. */
export async function killProcess(
	conn: Connection,
	rawId: unknown,
	i18n: Translator = SOURCE_TRANSLATOR
): Promise<KillResult> {
	const { t } = i18n;
	const id = parseProcessId(rawId);
	if (id === null) return { ok: false, reason: 'invalid', message: t('Invalid process id.') };
	if (id === (await connectionId(conn))) {
		return { ok: false, reason: 'own', message: t('You cannot kill your own connection.') };
	}
	try {
		await conn.query(`KILL ${id}`);
		return { ok: true };
	} catch (e) {
		const err = e as { code?: string; sqlMessage?: string };
		return {
			ok: false,
			reason: 'error',
			message: err.sqlMessage ?? t('Thread {id} could not be killed.', { id })
		};
	}
}
