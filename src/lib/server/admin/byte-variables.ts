/**
 * Variables whose values are byte sizes and are shown as KiB/MiB/GiB (phpMyAdmin
 * `ServerVariablesProvider::getVariableType() === 'byte'`).
 *
 * The first block is the `byte` type of the mariadb-mysql-kbs knowledge base that phpMyAdmin 5.2.3
 * ships (`vendor/williamdes/mariadb-mysql-kbs/dist/merged-ultraslim.json`, lower-cased). The second
 * block adds the core server sizes, which that knowledge base types as plain integers.
 */
const KB_BYTE_VARIABLES = [
	'aurora_binlog_io_cache_allocated',
	'aurora_fts_cache_memory_used',
	'aurora_lockmgr_memory_used',
	'aurora_pq_bytes_returned',
	'aurora_repl_bytes_received',
	'tokudb_cachetable_size_cachepressure',
	'tokudb_cachetable_size_cloned',
	'tokudb_cachetable_size_current',
	'tokudb_cachetable_size_leaf',
	'tokudb_cachetable_size_limit',
	'tokudb_cachetable_size_nonleaf',
	'tokudb_cachetable_size_rollback',
	'tokudb_cachetable_size_writing',
	'tokudb_leaf_nodes_flushed_checkpoint_bytes',
	'tokudb_leaf_nodes_flushed_not_checkpoint_bytes',
	'tokudb_locktree_latest_post_escalation_memory_size',
	'tokudb_locktree_memory_size',
	'tokudb_locktree_memory_size_limit',
	'tokudb_nonleaf_nodes_flushed_to_disk_checkpoint_bytes',
	'tokudb_nonleaf_nodes_flushed_to_disk_not_checkpoint_bytes',
	'tokudb_pivots_fetched_for_prefetch_bytes',
	'tokudb_pivots_fetched_for_query_bytes',
	'tokudb_pivots_fetched_for_write_bytes',
	'wsrep_received_bytes',
	'wsrep_replicated_bytes'
];

const CORE_BYTE_VARIABLES = [
	'binlog_cache_size',
	'binlog_stmt_cache_size',
	'innodb_buffer_pool_chunk_size',
	'innodb_buffer_pool_size',
	'innodb_ft_cache_size',
	'innodb_ft_total_cache_size',
	'innodb_log_buffer_size',
	'innodb_log_file_size',
	'innodb_page_size',
	'innodb_sort_buffer_size',
	'join_buffer_size',
	'key_buffer_size',
	'key_cache_block_size',
	'max_allowed_packet',
	'max_binlog_size',
	'max_heap_table_size',
	'myisam_sort_buffer_size',
	'net_buffer_length',
	'query_alloc_block_size',
	'query_cache_limit',
	'query_cache_size',
	'range_alloc_block_size',
	'read_buffer_size',
	'read_rnd_buffer_size',
	'sort_buffer_size',
	'thread_stack',
	'tmp_table_size',
	'transaction_alloc_block_size'
];

export const BYTE_VARIABLE_NAMES: ReadonlySet<string> = new Set([
	...KB_BYTE_VARIABLES,
	...CORE_BYTE_VARIABLES
]);
