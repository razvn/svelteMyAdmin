/** Server status data (libraries/classes/Server/Status/Data.php). */
import type { Connection } from 'mysql2/promise';
import { cleanDeprecated, calculateValues, type StatusMap } from '#lib/admin/status-vars.ts';

type Row = Record<string, unknown>;

async function keyValue(conn: Connection, sql: string): Promise<StatusMap> {
	const [rows] = await conn.query(sql);
	const out: StatusMap = {};
	for (const r of rows as Row[]) {
		const name = r.Variable_name ?? r.variable_name;
		const value = r.Value ?? r.value;
		if (name !== undefined) out[String(name)] = value === null ? '' : String(value);
	}
	return out;
}

export interface StatusData {
	status: StatusMap;
	variables: StatusMap;
}

/** SHOW GLOBAL STATUS (deprecated aliases cleaned, ratios added) and SHOW GLOBAL VARIABLES. */
export async function getStatusData(conn: Connection): Promise<StatusData> {
	const [rawStatus, variables] = await Promise.all([
		keyValue(conn, 'SHOW GLOBAL STATUS'),
		keyValue(conn, 'SHOW GLOBAL VARIABLES')
	]);
	return { status: calculateValues(cleanDeprecated(rawStatus), variables), variables };
}

export interface TrafficSummary {
	uptime: number;
	startedAt: string;
	bytesReceived: number;
	bytesSent: number;
	connections: number;
	maxUsedConnections: number;
	abortedConnects: number;
	abortedClients: number;
}

export function summarize(status: StatusMap, now = new Date()): TrafficSummary {
	const n = (k: string) => Number(status[k] ?? 0) || 0;
	const uptime = n('Uptime');
	return {
		uptime,
		startedAt: new Date(now.getTime() - uptime * 1000).toISOString(),
		bytesReceived: n('Bytes_received'),
		bytesSent: n('Bytes_sent'),
		connections: n('Connections'),
		maxUsedConnections: n('Max_used_connections'),
		abortedConnects: n('Aborted_connects'),
		abortedClients: n('Aborted_clients')
	};
}
