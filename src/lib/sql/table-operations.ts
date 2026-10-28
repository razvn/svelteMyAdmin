/**
 * Pure SQL builders for Table > Operations (Operations::getTableAltersArray, Query\Generator,
 * Table::rename, Controllers/Table/OperationsController.php). No I/O: unit-tested in
 * `table-operations.test.ts`, shared by the server actions and the live SQL preview.
 */
import { escapeId, escapeQualified, escapeString } from '#lib/sql/escape.ts';

export type OrderDirection = 'asc' | 'desc';

/** `ALTER TABLE ... ORDER BY` (Generator::getQueryForReorderingTable). */
export function buildReorderSql(table: string, column: string, order: OrderDirection): string {
	return `ALTER TABLE ${escapeId(table)} ORDER BY ${escapeId(column)} ${order === 'desc' ? 'DESC' : 'ASC'}`;
}

/** `RENAME TABLE` for a rename (same db) or a move (other db). Views are renamed the same way. */
export function buildRenameSql(db: string, table: string, newDb: string, newTable: string): string {
	return `RENAME TABLE ${escapeQualified(db, table)} TO ${escapeQualified(newDb, newTable)}`;
}

/** Table::isValidName($name, true): non empty, no trailing space, <= 64 chars, no path characters. */
export function validateTableName(name: string): string | null {
	if (name.length === 0) return 'The table name is empty!';
	if ([...name].length > 64 || /[\0/\\.]/.test(name) || /\s$/.test(name)) {
		return `Invalid table name: ${name}`;
	}
	return null;
}

/* -------------------------------------------------------------------------------------------
 * Table options
 * ----------------------------------------------------------------------------------------- */

/** Options as read from the server (information_schema.TABLES). */
export interface TableOptions {
	engine: string;
	comment: string;
	collation: string;
	/** `DEFAULT`, `0` or `1`. */
	packKeys: string;
	checksum: boolean;
	delayKeyWrite: boolean;
	transactional: boolean;
	pageChecksum: boolean;
	/** Next AUTO_INCREMENT value, '' when the table has none. */
	autoIncrement: string;
	rowFormat: string;
}

/** What the user asks for; `undefined` / '' = leave unchanged. */
export interface TableOptionsRequest {
	comment?: string;
	engine?: string;
	collation?: string;
	/** Charset of `collation` (CHARACTER SET is derived from the collation list). */
	charset?: string;
	packKeys?: string;
	checksum?: boolean;
	delayKeyWrite?: boolean;
	transactional?: boolean;
	pageChecksum?: boolean;
	autoIncrement?: string;
	rowFormat?: string;
}

const PACK_KEYS_ENGINES = ['MYISAM', 'ARIA', 'ISAM'];
const CHECKSUM_ENGINES = ['MYISAM', 'ARIA'];
const AUTO_INCREMENT_ENGINES = ['MYISAM', 'ARIA', 'INNODB', 'PBXT', 'ROCKSDB'];
const ROW_FORMAT_ENGINES = ['MYISAM', 'ARIA', 'INNODB', 'PBXT'];

export const engineIs = (engine: string, ...names: string[]): boolean =>
	names.includes(engine.toUpperCase());

/** Which option groups the form shows for `engine` (OperationsController: has_* flags). */
export function optionSupport(engine: string) {
	return {
		packKeys: engineIs(engine, ...PACK_KEYS_ENGINES),
		checksumAndDelayKeyWrite: engineIs(engine, ...CHECKSUM_ENGINES),
		transactionalAndPageChecksum: engineIs(engine, 'ARIA'),
		autoIncrement: engineIs(engine, ...AUTO_INCREMENT_ENGINES),
		rowFormat: engineIs(engine, ...ROW_FORMAT_ENGINES)
	};
}

/** Allowed ROW_FORMAT values per engine (Operations::getPossibleRowFormat); [] = none. */
export function rowFormatsFor(engine: string): string[] {
	switch (engine.toUpperCase()) {
		case 'ARCHIVE':
			return ['COMPRESSED'];
		case 'ARIA':
		case 'MARIA':
			return ['FIXED', 'DYNAMIC', 'PAGE'];
		case 'MYISAM':
		case 'PBXT':
			return ['FIXED', 'DYNAMIC'];
		case 'INNODB':
			return ['COMPACT', 'REDUNDANT', 'DYNAMIC', 'COMPRESSED'];
		default:
			return [];
	}
}

/** Parse the `CREATE_OPTIONS` column (`row_format=DYNAMIC pack_keys=1 partitioned`). */
export function parseCreateOptions(raw: string | null): Record<string, string> {
	const out: Record<string, string> = {};
	for (const part of (raw ?? '').split(/\s+/)) {
		const i = part.indexOf('=');
		if (i > 0) out[part.slice(0, i).toLowerCase()] = part.slice(i + 1);
		else if (part !== '') out[part.toLowerCase()] = '';
	}
	return out;
}

/** Build the current {@link TableOptions} from the information_schema columns. */
export function tableOptionsFromStatus(status: {
	engine: string | null;
	comment: string;
	collation: string | null;
	autoIncrement: number | string | null;
	rowFormat: string | null;
	createOptions: string | null;
}): TableOptions {
	const o = parseCreateOptions(status.createOptions);
	const packKeys = o.pack_keys ?? '';
	return {
		engine: status.engine ?? '',
		comment: status.comment,
		collation: status.collation ?? '',
		packKeys: packKeys === '' ? 'DEFAULT' : packKeys,
		checksum: (o.checksum ?? '0') === '1',
		delayKeyWrite: (o.delay_key_write ?? '0') === '1',
		// Aria: an absent option means 1 (the default)
		transactional: (o.transactional ?? '1') !== '0',
		pageChecksum: (o.page_checksum ?? '1') !== '0',
		autoIncrement:
			status.autoIncrement === null || status.autoIncrement === undefined
				? ''
				: String(status.autoIncrement),
		rowFormat: status.rowFormat ?? ''
	};
}

/**
 * The `ALTER TABLE` option clauses for the options that actually changed. Option groups are only
 * considered when the *current* engine supports them (like phpMyAdmin); `ENGINE` goes in the
 * same statement.
 */
export function buildOptionClauses(current: TableOptions, req: TableOptionsRequest): string[] {
	const out: string[] = [];
	const engine = current.engine;
	if (req.comment !== undefined && req.comment !== current.comment) {
		out.push(`COMMENT = '${escapeString(req.comment)}'`);
	}
	if (req.engine && req.engine.toLowerCase() !== engine.toLowerCase()) {
		out.push(`ENGINE = ${escapeId(req.engine)}`);
	}
	if (req.collation && req.collation !== current.collation) {
		out.push(
			(req.charset ? `DEFAULT CHARACTER SET ${escapeId(req.charset)} ` : 'DEFAULT ') +
				`COLLATE ${escapeId(req.collation)}`
		);
	}
	const sup = optionSupport(engine);
	if (sup.packKeys && req.packKeys !== undefined && req.packKeys !== current.packKeys) {
		if (['DEFAULT', '0', '1'].includes(req.packKeys)) out.push(`PACK_KEYS = ${req.packKeys}`);
	}
	if (sup.checksumAndDelayKeyWrite) {
		if (req.checksum !== undefined && req.checksum !== current.checksum) {
			out.push(`CHECKSUM = ${req.checksum ? 1 : 0}`);
		}
	}
	if (sup.transactionalAndPageChecksum) {
		if (req.transactional !== undefined && req.transactional !== current.transactional) {
			out.push(`TRANSACTIONAL = ${req.transactional ? 1 : 0}`);
		}
		if (req.pageChecksum !== undefined && req.pageChecksum !== current.pageChecksum) {
			out.push(`PAGE_CHECKSUM = ${req.pageChecksum ? 1 : 0}`);
		}
	}
	if (sup.checksumAndDelayKeyWrite) {
		if (req.delayKeyWrite !== undefined && req.delayKeyWrite !== current.delayKeyWrite) {
			out.push(`DELAY_KEY_WRITE = ${req.delayKeyWrite ? 1 : 0}`);
		}
	}
	if (
		sup.autoIncrement &&
		req.autoIncrement &&
		/^\d+$/.test(req.autoIncrement) &&
		req.autoIncrement !== current.autoIncrement
	) {
		out.push(`AUTO_INCREMENT = ${req.autoIncrement}`);
	}
	if (
		sup.rowFormat &&
		req.rowFormat &&
		req.rowFormat.toLowerCase() !== current.rowFormat.toLowerCase() &&
		/^[A-Za-z_]+$/.test(req.rowFormat)
	) {
		out.push(`ROW_FORMAT = ${req.rowFormat.toUpperCase()}`);
	}
	return out;
}

/** One `ALTER TABLE` with every changed option; null when nothing changed. */
export function buildOptionsAlter(
	table: string,
	current: TableOptions,
	req: TableOptionsRequest
): string | null {
	const clauses = buildOptionClauses(current, req);
	return clauses.length === 0 ? null : `ALTER TABLE ${escapeId(table)}\n${clauses.join('\n')}`;
}

/** Statements the options form runs after an optional rename (also the live SQL preview). */
export function buildOptionStatements(
	table: string,
	current: TableOptions,
	req: TableOptionsRequest,
	changeAll: boolean
): string[] {
	const alter = buildOptionsAlter(
		table,
		current,
		changeAll ? { ...req, collation: undefined } : req
	);
	const out = alter ? [alter] : [];
	if (changeAll && req.collation && req.charset) {
		out.push(buildConvertCollationSql(table, req.charset, req.collation));
	}
	return out;
}

/* -------------------------------------------------------------------------------------------
 * Maintenance, delete, partitions
 * ----------------------------------------------------------------------------------------- */

export const MAINTENANCE_ACTIONS = [
	'analyze',
	'check',
	'checksum',
	'defragment',
	'flush',
	'optimize',
	'repair'
] as const;
export type MaintenanceAction = (typeof MAINTENANCE_ACTIONS)[number];

export const MAINTENANCE_LABELS: Record<MaintenanceAction, string> = {
	analyze: 'Analyze table',
	check: 'Check table',
	checksum: 'Checksum table',
	defragment: 'Defragment table',
	flush: 'Flush the table (FLUSH)',
	optimize: 'Optimize table',
	repair: 'Repair table'
};

/** Which maintenance actions the template offers for `engine` (templates/table/operations/index.twig). */
export function maintenanceActionsFor(engine: string, isView: boolean): MaintenanceAction[] {
	if (isView) return ['check', 'checksum'];
	const e = engine.toUpperCase();
	const out: MaintenanceAction[] = [];
	if (['MYISAM', 'ARIA', 'INNODB', 'BERKELEYDB', 'TOKUDB'].includes(e)) out.push('analyze');
	if (['MYISAM', 'ARIA', 'INNODB', 'TOKUDB'].includes(e)) out.push('check');
	out.push('checksum');
	if (e === 'INNODB') out.push('defragment');
	out.push('flush');
	if (['MYISAM', 'ARIA', 'INNODB', 'BERKELEYDB', 'TOKUDB'].includes(e)) out.push('optimize');
	if (['MYISAM', 'ARIA'].includes(e)) out.push('repair');
	return out;
}

export function buildMaintenanceSql(action: MaintenanceAction, db: string, table: string): string {
	const q = escapeQualified(db, table);
	switch (action) {
		case 'defragment':
			return `ALTER TABLE ${q} ENGINE = InnoDB`;
		case 'flush':
			return `FLUSH TABLE ${q}`;
		default:
			return `${action.toUpperCase()} TABLE ${q}`;
	}
}

export const buildTruncateSql = (db: string, table: string): string =>
	`TRUNCATE TABLE ${escapeQualified(db, table)}`;

export const buildDropSql = (db: string, table: string, isView: boolean): string =>
	`DROP ${isView ? 'VIEW' : 'TABLE'} ${escapeQualified(db, table)}`;

export const PARTITION_OPERATIONS = [
	'ANALYZE',
	'CHECK',
	'OPTIMIZE',
	'REBUILD',
	'REPAIR',
	'TRUNCATE',
	'COALESCE',
	'DROP'
] as const;
export type PartitionOperation = (typeof PARTITION_OPERATIONS)[number];

/** Operations offered for a partitioning method (COALESCE for HASH/KEY, DROP for RANGE/LIST). */
export function partitionOperationsFor(method: string): PartitionOperation[] {
	const base: PartitionOperation[] = [
		'ANALYZE',
		'CHECK',
		'OPTIMIZE',
		'REBUILD',
		'REPAIR',
		'TRUNCATE'
	];
	return /^(RANGE|LIST)/i.test(method) ? [...base, 'DROP'] : [...base, 'COALESCE'];
}

/** Generator::getQueryForPartitioningTable. COALESCE takes a count, the others the names. */
export function buildPartitionSql(
	table: string,
	operation: PartitionOperation,
	partitions: string[]
): string {
	const head = `ALTER TABLE ${escapeId(table)} ${operation} PARTITION `;
	return operation === 'COALESCE'
		? head + partitions.length
		: head + partitions.map(escapeId).join(', ');
}

export const buildRemovePartitioningSql = (table: string): string =>
	`ALTER TABLE ${escapeId(table)} REMOVE PARTITIONING`;

/** Partition maintenance operations that return a result set (Table/Op/Msg_type/Msg_text). */
export const partitionReturnsResult = (op: PartitionOperation): boolean =>
	['ANALYZE', 'CHECK', 'OPTIMIZE', 'REPAIR'].includes(op);

/** Statements of the "change all column collations" option (Operations::changeAllColumnsCollation). */
export function buildConvertCollationSql(
	table: string,
	charset: string,
	collation: string
): string {
	return `ALTER TABLE ${escapeId(table)} CONVERT TO CHARACTER SET ${escapeId(charset)} COLLATE ${escapeId(collation)}`;
}

const IDENT = '(?:`(?:[^`]|``)+`|\\w+)';

/**
 * Point a `SHOW CREATE TRIGGER` statement at another table. The trigger is created in the current
 * database, so qualifiers are dropped (MariaDB writes `db`.trigger ... ON `db`.table).
 */
export function retargetTrigger(createSql: string, newTable: string): string {
	return createSql
		.replace(
			new RegExp(`(\\sTRIGGER\\s+)(?:${IDENT}\\.)?(${IDENT})`, 'i'),
			(_m, a: string, name: string) => a + name
		)
		.replace(
			new RegExp(`(\\sON\\s+)${IDENT}(?:\\.${IDENT})?(\\s+FOR\\s+EACH\\s+ROW)`, 'i'),
			(_m, a: string, b: string) => `${a}${escapeId(newTable)}${b}`
		);
}
