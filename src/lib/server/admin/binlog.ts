/** Binary log browser (Controllers/Server/BinlogController.php). */
import type { Connection } from 'mysql2/promise';

type Row = Record<string, unknown>;

export interface BinlogFile {
	name: string;
	size: number;
}

export interface BinlogEvent {
	logName: string;
	pos: number;
	eventType: string;
	serverId: number;
	endLogPos: number;
	info: string;
}

export const BINLOG_PAGE_SIZE = 100;

export async function isBinlogEnabled(conn: Connection): Promise<boolean> {
	try {
		const [rows] = await conn.query('SELECT @@GLOBAL.log_bin AS v');
		const v = (rows as Row[])[0]?.v;
		return v === 1 || v === '1' || String(v).toUpperCase() === 'ON';
	} catch {
		return false;
	}
}

/** SHOW BINARY LOGS; empty when the binary log is off or the user lacks privileges. */
export async function listBinlogs(conn: Connection): Promise<BinlogFile[]> {
	try {
		const [rows] = await conn.query('SHOW BINARY LOGS');
		return (rows as Row[]).map((r) => ({
			name: String(r.Log_name),
			size: Number(r.File_size ?? 0)
		}));
	} catch {
		return [];
	}
}

export interface BinlogPage {
	events: BinlogEvent[];
	hasMore: boolean;
}

/** SHOW BINLOG EVENTS IN ? LIMIT offset, count. `file` must be one of the listed logs. */
export async function getBinlogEvents(
	conn: Connection,
	file: string,
	offset: number,
	count = BINLOG_PAGE_SIZE
): Promise<BinlogPage> {
	const off = Math.max(0, Math.floor(offset));
	const cnt = Math.max(1, Math.floor(count));
	const [rows] = await conn.query('SHOW BINLOG EVENTS IN ? LIMIT ?, ?', [file, off, cnt + 1]);
	const all = (rows as Row[]).map((r) => ({
		logName: String(r.Log_name),
		pos: Number(r.Pos),
		eventType: String(r.Event_type),
		serverId: Number(r.Server_id),
		endLogPos: Number(r.End_log_pos),
		info: r.Info === null || r.Info === undefined ? '' : String(r.Info)
	}));
	return { events: all.slice(0, cnt), hasMore: all.length > cnt };
}
