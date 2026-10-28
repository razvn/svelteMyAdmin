/**
 * DatabaseInterface-style metadata service (see libraries/classes/DatabaseInterface.php).
 * Values go through `?` placeholders, identifiers through escapeId/escapeQualified.
 */
import type { Connection } from 'mysql2/promise';
import type { ServerConfig } from '../config/schema';
import { filterDatabases } from './database-filter';
import { escapeId, escapeQualified } from './escape';

export type ServerType = 'MySQL' | 'MariaDB' | 'Percona Server';

export interface ServerInfo {
	version: string;
	versionComment: string;
	serverType: ServerType;
	/** Numeric version, e.g. 80404 for 8.4.4. */
	versionInt: number;
	protocolVersion: number;
	currentUser: string;
	connectionUser: string;
	charset: string;
	collation: string;
	hostname: string;
}

export interface CollationInfo {
	name: string;
	charset: string;
	isDefault: boolean;
}

export interface TableInfo {
	name: string;
	type: 'BASE TABLE' | 'VIEW' | 'SYSTEM VIEW' | string;
	engine: string | null;
	rows: number | null;
	dataLength: number | null;
	indexLength: number | null;
	collation: string | null;
	comment: string;
}

export interface RoutineInfo {
	name: string;
	type: 'PROCEDURE' | 'FUNCTION';
	returns: string;
	definer: string;
	deterministic: boolean;
	securityType: string;
	comment: string;
}

export interface EventInfo {
	name: string;
	status: string;
	type: string;
	executeAt: string | null;
	intervalValue: string | null;
	intervalField: string | null;
	starts: string | null;
	ends: string | null;
	definer: string;
	comment: string;
}

export interface TriggerInfo {
	name: string;
	event: string;
	table: string;
	timing: string;
	definer: string;
}

export interface ColumnInfo {
	field: string;
	type: string;
	collation: string | null;
	null: boolean;
	key: string;
	default: string | null;
	extra: string;
	privileges: string;
	comment: string;
}

export interface IndexInfo {
	table: string;
	nonUnique: boolean;
	keyName: string;
	seqInIndex: number;
	columnName: string | null;
	collation: string | null;
	cardinality: number | null;
	subPart: number | null;
	packed: string | null;
	nullable: boolean;
	indexType: string;
	comment: string;
	indexComment: string;
	expression: string | null;
}

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

/** Parse `8.4.4-log` / `10.11.6-MariaDB-1:10.11.6` into 80404 / 101106. */
export function versionToInt(version: string): number {
	const m = version.match(/^(\d+)\.(\d+)\.(\d+)/);
	return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 0;
}

export function detectServerType(version: string, comment: string): ServerType {
	if (/mariadb/i.test(version) || /mariadb/i.test(comment)) return 'MariaDB';
	if (/percona/i.test(comment) || /percona/i.test(version)) return 'Percona Server';
	return 'MySQL';
}

export class DatabaseInterface {
	constructor(
		readonly conn: Connection,
		readonly server: Pick<ServerConfig, 'only_db' | 'hide_db' | 'host' | 'port'>
	) {}

	private async rows(sql: string, params: unknown[] = []): Promise<Row[]> {
		const [rows] = await this.conn.query(sql, params);
		return rows as Row[];
	}

	async getServerInfo(): Promise<ServerInfo> {
		const [r] = await this.rows(
			'SELECT VERSION() AS version, @@version_comment AS version_comment, ' +
				'CURRENT_USER() AS current_user_, USER() AS connection_user, ' +
				'@@character_set_connection AS charset, @@collation_connection AS collation, ' +
				'@@hostname AS hostname, @@protocol_version AS protocol_version'
		);
		const version = str(r.version);
		const comment = str(r.version_comment);
		return {
			version,
			versionComment: comment,
			serverType: detectServerType(version, comment),
			versionInt: versionToInt(version),
			protocolVersion: Number(r.protocol_version ?? 10),
			currentUser: str(r.current_user_),
			connectionUser: str(r.connection_user),
			charset: str(r.charset),
			collation: str(r.collation),
			hostname: str(r.hostname)
		};
	}

	/** Does the database exist and is it visible (`only_db` / `hide_db`)? Exact (case-sensitive) name. */
	async databaseExists(name: string): Promise<boolean> {
		const rows = await this.rows(
			'SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?',
			[name]
		);
		const found = rows.map((r) => str(r.name)).filter((n) => n === name);
		return filterDatabases(found, this.server).length > 0;
	}

	/** `TABLE_TYPE` of a table (`BASE TABLE`, `VIEW`, `SYSTEM VIEW`, ...) or null when it does not exist. */
	async getTableType(db: string, table: string): Promise<string | null> {
		const rows = await this.rows(
			'SELECT TABLE_NAME AS name, TABLE_TYPE AS type FROM information_schema.TABLES ' +
				'WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
			[db, table]
		);
		const hit = rows.find((r) => str(r.name) === table);
		return hit ? str(hit.type) : null;
	}

	/** Collations of the server (information_schema.COLLATIONS), default ones flagged. */
	async listCollations(): Promise<CollationInfo[]> {
		const rows = await this.rows(
			'SELECT COLLATION_NAME AS name, CHARACTER_SET_NAME AS charset, IS_DEFAULT AS is_default ' +
				'FROM information_schema.COLLATIONS ORDER BY COLLATION_NAME'
		);
		return rows.map((r) => ({
			name: str(r.name),
			charset: str(r.charset),
			isDefault: str(r.is_default) === 'Yes'
		}));
	}

	/** Is the current connection encrypted (non-empty `Ssl_cipher`)? */
	async isSslConnection(): Promise<boolean> {
		const rows = await this.rows("SHOW SESSION STATUS LIKE 'Ssl_cipher'");
		return rows.length > 0 && str(Object.values(rows[0])[1]) !== '';
	}

	/** All databases visible to the user, honouring `only_db` and `hide_db`. */
	async listDatabases(): Promise<string[]> {
		const rows = await this.rows(
			'SELECT SCHEMA_NAME AS name FROM information_schema.SCHEMATA ORDER BY SCHEMA_NAME'
		);
		return filterDatabases(
			rows.map((r) => str(r.name)),
			this.server
		);
	}

	async listTables(db: string): Promise<TableInfo[]> {
		const rows = await this.rows(
			'SELECT TABLE_NAME AS name, TABLE_TYPE AS type, ENGINE AS engine, TABLE_ROWS AS table_rows, ' +
				'DATA_LENGTH AS data_length, INDEX_LENGTH AS index_length, TABLE_COLLATION AS collation, ' +
				'TABLE_COMMENT AS comment FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME',
			[db]
		);
		return rows.map((r) => ({
			name: str(r.name),
			type: str(r.type),
			engine: strOrNull(r.engine),
			rows: numOrNull(r.table_rows),
			dataLength: numOrNull(r.data_length),
			indexLength: numOrNull(r.index_length),
			collation: strOrNull(r.collation),
			comment: str(r.comment)
		}));
	}

	async listRoutines(db: string): Promise<RoutineInfo[]> {
		const rows = await this.rows(
			'SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type, DTD_IDENTIFIER AS returns, DEFINER AS definer, ' +
				'IS_DETERMINISTIC AS is_deterministic, SECURITY_TYPE AS security_type, ROUTINE_COMMENT AS comment ' +
				'FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? ORDER BY ROUTINE_NAME',
			[db]
		);
		return rows.map((r) => ({
			name: str(r.name),
			type: str(r.type) as RoutineInfo['type'],
			returns: str(r.returns),
			definer: str(r.definer),
			deterministic: str(r.is_deterministic) === 'YES',
			securityType: str(r.security_type),
			comment: str(r.comment)
		}));
	}

	async listEvents(db: string): Promise<EventInfo[]> {
		const rows = await this.rows(
			'SELECT EVENT_NAME AS name, STATUS AS status, EVENT_TYPE AS type, EXECUTE_AT AS execute_at, ' +
				'INTERVAL_VALUE AS interval_value, INTERVAL_FIELD AS interval_field, STARTS AS starts, ' +
				'ENDS AS ends, DEFINER AS definer, EVENT_COMMENT AS comment ' +
				'FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ? ORDER BY EVENT_NAME',
			[db]
		);
		return rows.map((r) => ({
			name: str(r.name),
			status: str(r.status),
			type: str(r.type),
			executeAt: strOrNull(r.execute_at),
			intervalValue: strOrNull(r.interval_value),
			intervalField: strOrNull(r.interval_field),
			starts: strOrNull(r.starts),
			ends: strOrNull(r.ends),
			definer: str(r.definer),
			comment: str(r.comment)
		}));
	}

	async listTriggers(db: string): Promise<TriggerInfo[]> {
		const rows = await this.rows(
			'SELECT TRIGGER_NAME AS name, EVENT_MANIPULATION AS event, EVENT_OBJECT_TABLE AS table_name, ' +
				'ACTION_TIMING AS timing, DEFINER AS definer FROM information_schema.TRIGGERS ' +
				'WHERE TRIGGER_SCHEMA = ? ORDER BY TRIGGER_NAME',
			[db]
		);
		return rows.map((r) => ({
			name: str(r.name),
			event: str(r.event),
			table: str(r.table_name),
			timing: str(r.timing),
			definer: str(r.definer)
		}));
	}

	async getColumns(db: string, table: string): Promise<ColumnInfo[]> {
		const rows = await this.rows(`SHOW FULL COLUMNS FROM ${escapeQualified(db, table)}`);
		return rows.map((r) => ({
			field: str(r.Field),
			type: str(r.Type),
			collation: strOrNull(r.Collation),
			null: str(r.Null) === 'YES',
			key: str(r.Key),
			default: strOrNull(r.Default),
			extra: str(r.Extra),
			privileges: str(r.Privileges),
			comment: str(r.Comment)
		}));
	}

	async getIndexes(db: string, table: string): Promise<IndexInfo[]> {
		const rows = await this.rows(`SHOW INDEXES FROM ${escapeId(table)} FROM ${escapeId(db)}`);
		return rows.map((r) => ({
			table: str(r.Table),
			nonUnique: Number(r.Non_unique) === 1,
			keyName: str(r.Key_name),
			seqInIndex: Number(r.Seq_in_index),
			columnName: strOrNull(r.Column_name),
			collation: strOrNull(r.Collation),
			cardinality: numOrNull(r.Cardinality),
			subPart: numOrNull(r.Sub_part),
			packed: strOrNull(r.Packed),
			nullable: str(r.Null) === 'YES',
			indexType: str(r.Index_type),
			comment: str(r.Comment),
			indexComment: str(r.Index_comment),
			expression: strOrNull(r.Expression)
		}));
	}
}
