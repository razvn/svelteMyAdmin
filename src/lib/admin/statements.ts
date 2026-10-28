/**
 * Which SQL statement to use per server type/version (renames of the SHOW MASTER/SLAVE family).
 * Pure: takes the `serverType` / `versionInt` fields of ServerInfo.
 */

export interface ServerVersion {
	serverType: string;
	/** e.g. 80404 for 8.4.4 */
	versionInt: number;
}

const isMariaDB = (s: ServerVersion) => s.serverType === 'MariaDB';

/** SHOW BINARY LOG STATUS replaced SHOW MASTER STATUS in MySQL 8.2 (removed in 8.4). */
export function primaryStatusSql(s: ServerVersion): string {
	if (!isMariaDB(s) && s.versionInt >= 80200) return 'SHOW BINARY LOG STATUS';
	return 'SHOW MASTER STATUS';
}

/** SHOW REPLICA STATUS: MySQL >= 8.0.22, MariaDB >= 10.5.1. */
export function replicaStatusSql(s: ServerVersion): string {
	const modern = isMariaDB(s) ? s.versionInt >= 100501 : s.versionInt >= 80022;
	return modern ? 'SHOW REPLICA STATUS' : 'SHOW SLAVE STATUS';
}

/** Connected replicas: SHOW REPLICAS (MySQL >= 8.0.22), SHOW SLAVE HOSTS otherwise. */
export function replicaHostsSql(s: ServerVersion): string {
	if (!isMariaDB(s) && s.versionInt >= 80022) return 'SHOW REPLICAS';
	return 'SHOW SLAVE HOSTS';
}

/** Read a replica status column that MySQL 8.0.22+ renamed from Slave_* to Replica_*. */
export function replicaField(row: Record<string, unknown>, name: string): string {
	const candidates = [
		name,
		name.replace(/^Slave_/, 'Replica_'),
		name.replace(/^Replica_/, 'Slave_')
	];
	for (const c of candidates) {
		const v = row[c];
		if (v !== undefined && v !== null) return String(v);
	}
	return '';
}
