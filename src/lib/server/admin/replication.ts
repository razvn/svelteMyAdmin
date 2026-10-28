/** Replication status (Controllers/Server/ReplicationController.php, Server/Replication*). Read-only. */
import type { Connection } from 'mysql2/promise';
import {
	primaryStatusSql,
	replicaHostsSql,
	replicaStatusSql,
	type ServerVersion
} from '#lib/admin/statements.ts';

type Row = Record<string, unknown>;

export interface ReplicationRow {
	[column: string]: string;
}

export interface ReplicationOverview {
	/** Binary log status row, null when the binary log is off (not a primary) or not readable. */
	primary: ReplicationRow | null;
	/** Connected replicas as seen by this primary. */
	replicaHosts: ReplicationRow[];
	/** One entry per replication channel/connection; empty when this is not a replica. */
	replicas: ReplicationRow[];
	/** Statements that were run, for display. */
	statements: { primary: string; replica: string; hosts: string };
	/** Errors from statements that failed (typically missing REPLICATION CLIENT privilege). */
	errors: string[];
}

const toRow = (r: Row): ReplicationRow =>
	Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v === null ? '' : String(v)]));

async function tryRows(conn: Connection, sql: string, errors: string[]): Promise<ReplicationRow[]> {
	try {
		const [rows] = await conn.query(sql);
		return (rows as Row[]).map(toRow);
	} catch (e) {
		errors.push(`${sql}: ${(e as { sqlMessage?: string }).sqlMessage ?? 'failed'}`);
		return [];
	}
}

export async function getReplication(
	conn: Connection,
	server: ServerVersion
): Promise<ReplicationOverview> {
	const statements = {
		primary: primaryStatusSql(server),
		replica: replicaStatusSql(server),
		hosts: replicaHostsSql(server)
	};
	const errors: string[] = [];
	const primaryRows = await tryRows(conn, statements.primary, errors);
	const replicas = await tryRows(conn, statements.replica, errors);
	const replicaHosts = primaryRows.length ? await tryRows(conn, statements.hosts, errors) : [];
	return { primary: primaryRows[0] ?? null, replicaHosts, replicas, statements, errors };
}
