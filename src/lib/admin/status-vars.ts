/**
 * Status variable categorisation, alert thresholds and derived values
 * (libraries/classes/Server/Status/Data.php, Controllers/Server/Status/VariablesController.php).
 * Pure: no framework imports.
 */

/** Prefix -> section, first match wins (Data::getAllocations). */
export const ALLOCATIONS: [string, string][] = [
	['Com_', 'com'],
	['Innodb_', 'innodb'],
	['Ndb_', 'ndb'],
	['Handler_', 'handler'],
	['Qcache_', 'qcache'],
	['Threads_', 'threads'],
	['Slow_launch_threads', 'threads'],
	['Binlog_cache_', 'binlog_cache'],
	['Created_tmp_', 'created_tmp'],
	['Key_', 'key'],
	['Delayed_', 'delayed'],
	['Not_flushed_delayed_rows', 'delayed'],
	['Flush_commands', 'query'],
	['Last_query_cost', 'query'],
	['Slow_queries', 'query'],
	['Queries', 'query'],
	['Prepared_stmt_count', 'query'],
	['Select_', 'select'],
	['Sort_', 'sort'],
	['Open_tables', 'table'],
	['Opened_tables', 'table'],
	['Open_table_definitions', 'table'],
	['Opened_table_definitions', 'table'],
	['Table_locks_', 'table'],
	['Rpl_status', 'repl'],
	['Slave_', 'repl'],
	['Tc_', 'tc'],
	['Ssl_', 'ssl'],
	['Open_files', 'files'],
	['Open_streams', 'files'],
	['Opened_files', 'files']
];

/** Section id -> label (Data::getSections). */
export const SECTIONS: Record<string, string> = {
	com: 'Com',
	query: 'SQL query',
	innodb: 'InnoDB',
	ndb: 'NDB',
	handler: 'Handler',
	qcache: 'Query cache',
	threads: 'Threads',
	binlog_cache: 'Binary log',
	created_tmp: 'Temporary data',
	delayed: 'Delayed inserts',
	key: 'Key cache',
	select: 'Joins',
	repl: 'Replication',
	sort: 'Sorting',
	table: 'Tables',
	tc: 'Transaction coordinator',
	files: 'Files',
	ssl: 'SSL',
	other: 'Other'
};

export type StatusMap = Record<string, string>;

/** Section of a status variable name (`other` when no prefix matches). */
export function sectionOf(name: string): string {
	for (const [filter, section] of ALLOCATIONS) if (name.includes(filter)) return section;
	return 'other';
}

/** Drop deprecated Com_*_sql aliases when the new name exists (Data::cleanDeprecated). */
export function cleanDeprecated(status: StatusMap): StatusMap {
	const out = { ...status };
	const deprecated: Record<string, string> = {
		Com_prepare_sql: 'Com_stmt_prepare',
		Com_execute_sql: 'Com_stmt_execute',
		Com_dealloc_sql: 'Com_stmt_close'
	};
	for (const [old, replacement] of Object.entries(deprecated)) {
		if (old in out && replacement in out) delete out[old];
	}
	return out;
}

const num = (v: string | undefined) => (v === undefined ? undefined : Number(v));

/** Add the computed ratios of Data::calculateValues. */
export function calculateValues(status: StatusMap, variables: StatusMap): StatusMap {
	const out = { ...status };
	const keyBuf = num(variables.key_buffer_size);
	const unused = num(out.Key_blocks_unused);
	const blockSize = num(variables.key_cache_block_size);
	const used = num(out.Key_blocks_used);
	if (unused !== undefined && blockSize !== undefined && keyBuf) {
		out['Key_buffer_fraction_%'] = String(100 - ((unused * blockSize) / keyBuf) * 100);
	} else if (used !== undefined && keyBuf) {
		out['Key_buffer_fraction_%'] = String((used * 1024) / keyBuf);
	}
	const kw = num(out.Key_writes);
	const kwr = num(out.Key_write_requests);
	if (kw !== undefined && kwr) out['Key_write_ratio_%'] = String((100 * kw) / kwr);
	const kr = num(out.Key_reads);
	const krr = num(out.Key_read_requests);
	if (kr !== undefined && krr) out['Key_read_ratio_%'] = String((100 * kr) / krr);
	const tc = num(out.Threads_created);
	const conns = num(out.Connections);
	if (tc !== undefined && conns) out['Threads_cache_hitrate_%'] = String(100 - (tc / conns) * 100);
	return out;
}

/** Alert thresholds: variable -> max value before it is flagged (VariablesController::getAlerts). */
export function getAlerts(status: StatusMap, variables: StatusMap): Record<string, number> {
	return {
		Aborted_clients: 0,
		Aborted_connects: 0,
		Binlog_cache_disk_use: 0,
		Created_tmp_disk_tables: 0,
		Handler_read_rnd: 0,
		Handler_read_rnd_next: 0,
		Innodb_buffer_pool_pages_dirty: 0,
		Innodb_buffer_pool_reads: 0,
		Innodb_buffer_pool_wait_free: 0,
		Innodb_log_waits: 0,
		Innodb_row_lock_time_avg: 10,
		Innodb_row_lock_time_max: 50,
		Innodb_row_lock_waits: 0,
		Slow_queries: 0,
		Delayed_errors: 0,
		Select_full_join: 0,
		Select_range_check: 0,
		Sort_merge_passes: 0,
		Opened_tables: 0,
		Table_locks_waited: 0,
		Qcache_lowmem_prunes: 0,
		Qcache_free_blocks: (num(status.Qcache_total_blocks) ?? 0) / 5,
		Slow_launch_threads: 0,
		Key_reads: 0.01 * (num(status.Key_read_requests) ?? 0),
		Key_writes: 0.9 * (num(status.Key_write_requests) ?? 0),
		'Key_buffer_fraction_%': 0.5,
		Threads_cached: 0.95 * (num(variables.thread_cache_size) ?? 0)
	};
}

export interface StatusVariable {
	name: string;
	value: string;
	isNumeric: boolean;
	section: string;
	hasAlert: boolean;
	isAlert: boolean;
	description: string;
}

export function isNumeric(value: string): boolean {
	return value.trim() !== '' && Number.isFinite(Number(value));
}

/** Build the table rows of the "All status variables" page. */
export function buildVariables(
	status: StatusMap,
	variables: StatusMap,
	descriptions: Record<string, string>
): StatusVariable[] {
	const alerts = getAlerts(status, variables);
	return Object.entries(status).map(([name, value]) => {
		const hasAlert = name in alerts;
		return {
			name,
			value,
			isNumeric: isNumeric(value),
			section: sectionOf(name),
			hasAlert,
			isAlert: hasAlert && Number(value) > alerts[name],
			description: descriptions[name] ?? ''
		};
	});
}

export interface VariableFilter {
	text: string;
	category: string;
	onlyAlerts: boolean;
}

/** Filter by name words (underscores count as spaces), category and alert state. */
export function filterVariables(vars: StatusVariable[], f: VariableFilter): StatusVariable[] {
	const terms = f.text.trim().toLowerCase().split(/\s+/).filter(Boolean);
	return vars.filter((v) => {
		if (f.category && v.section !== f.category) return false;
		if (f.onlyAlerts && !v.isAlert) return false;
		const name = v.name.toLowerCase();
		const spaced = name.replace(/_/g, ' ');
		return terms.every((t) => name.includes(t) || spaced.includes(t));
	});
}

/** Categories actually used, in SECTIONS order. */
export function usedCategories(vars: StatusVariable[]): { id: string; name: string }[] {
	const used = new Set(vars.map((v) => v.section));
	return Object.entries(SECTIONS)
		.filter(([id]) => used.has(id))
		.map(([id, name]) => ({ id, name }));
}
