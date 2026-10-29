import { describe, expect, it } from 'vitest';
import { rulesFor, ruleHtml, ruleText, runAdvisor, type AdvisorInput } from './engine.ts';
import { parse } from './expression.ts';
import { BEFORE_MYSQL_80003_RULES, GENERIC_RULES } from './rules.ts';

const ALL = [...GENERIC_RULES, ...BEFORE_MYSQL_80003_RULES];

const status = {
	Uptime: '1000000',
	Questions: '5000000',
	Slow_queries: '10',
	Connections: '10000',
	Threads_created: '100',
	Aborted_clients: '0',
	Aborted_connects: '0',
	Max_used_connections: '20',
	Created_tmp_tables: '1000',
	Created_tmp_disk_tables: '10',
	Select_full_join: '0',
	Select_range_check: '0',
	Select_scan: '100',
	Sort_merge_passes: '0',
	Sort_scan: '100',
	Sort_range: '100',
	Sort_rows: '1000',
	Handler_read_first: '1',
	Handler_read_rnd: '1',
	Handler_read_rnd_next: '1',
	Table_locks_immediate: '1000',
	Table_locks_waited: '0',
	Opened_tables: '10',
	Open_files: '10',
	Slow_launch_threads: '0',
	Key_blocks_used: '1',
	Key_read_requests: '1000',
	Key_reads: '1',
	Com_select: '100',
	Qcache_hits: '0',
	Qcache_inserts: '0',
	Qcache_free_memory: '0',
	Qcache_free_blocks: '0',
	Qcache_total_blocks: '0',
	Qcache_lowmem_prunes: '0'
};
const variables = {
	version: '8.4.4',
	version_comment: 'MySQL Community Server - GPL',
	version_compile_machine: 'x86_64',
	version_compile_os: 'Linux',
	long_query_time: '10',
	slow_query_log: 'OFF',
	max_connections: '151',
	open_files_limit: '1024',
	thread_cache_size: '9',
	tmp_table_size: '16777216',
	max_heap_table_size: '16777216',
	key_buffer_size: '8388608',
	key_cache_block_size: '1024',
	slow_launch_time: '2',
	concurrent_insert: 'AUTO',
	have_innodb: 'YES',
	innodb_buffer_pool_size: '134217728',
	innodb_log_file_size: '50331648',
	innodb_log_files_in_group: '2',
	query_cache_size: '0',
	query_cache_type: 'OFF',
	query_cache_limit: '1048576'
};

const input = (over: Partial<AdvisorInput> = {}): AdvisorInput => ({
	status,
	variables,
	versionInt: 80404,
	isMariaDB: false,
	systemMemory: 8 * 1024 * 1024,
	...over
});
const ids = (rs: { id: string }[]) => rs.map((r) => r.id);

describe('rules data', () => {
	it('ports all rules of both PHP files', () => {
		expect(GENERIC_RULES).toHaveLength(48);
		expect(BEFORE_MYSQL_80003_RULES).toHaveLength(7);
	});
	it('every expression parses', () => {
		for (const r of ALL) {
			for (const src of [r.precondition, r.formula, r.test]) if (src) parse(src);
			if (r.justification_formula) parse(`[${r.justification_formula}]`);
			expect(r.formula).toBeTruthy();
		}
	});
	it('picks rule sets by server', () => {
		expect(rulesFor(false, 80404)).toBe(GENERIC_RULES);
		expect(rulesFor(false, 50700)).toHaveLength(55);
		expect(rulesFor(true, 110407)).toHaveLength(55);
	});
});

describe('runAdvisor on fixture data', () => {
	it('evaluates every rule of a MySQL 8 server without errors', () => {
		const r = runAdvisor(input());
		expect(r.errors).toEqual([]);
		expect(r.fired.length + r.notfired.length + r.unchecked.length).toBe(GENERIC_RULES.length);
	});
	it('fires the slow query log / long query time rules with formatted justification', () => {
		const r = runAdvisor(input());
		expect(ids(r.fired)).toContain('Long query time');
		expect(ids(r.fired)).toContain('Slow query logging');
		const lqt = r.fired.find((x) => x.id === 'Long query time')!;
		expect(lqt.justification).toBe('long_query_time is currently set to 10s.');
		expect(lqt.used.map((u) => u.name)).toEqual(['long_query_time']);
	});
	it('formats uptime and percentages', () => {
		const r = runAdvisor(input({ status: { ...status, Uptime: '90061' } }));
		const up = r.fired.find((x) => x.id === 'Uptime below one day');
		expect(up).toBeUndefined();
		const r2 = runAdvisor(input({ status: { ...status, Uptime: '3600' } }));
		expect(r2.fired.find((x) => x.id === 'Uptime below one day')!.justification).toBe(
			'The uptime is only 0 days, 1 hours, 0 minutes and 0 seconds'
		);
		const r3 = runAdvisor(input({ status: { ...status, Slow_queries: '500000' } }));
		expect(r3.fired.find((x) => x.id === 'Percentage of slow queries')!.justification).toBe(
			'The slow query rate should be below 5%, your value is 10%.'
		);
	});
	it('skips rules whose precondition is false', () => {
		const r = runAdvisor(input({ status: { ...status, Questions: '0' } }));
		expect(ids(r.unchecked)).toContain('Percentage of slow queries');
		expect(r.errors).toEqual([]);
	});
	it('skips memory rules when the host memory is unknown', () => {
		const r = runAdvisor(input({ systemMemory: 0 }));
		expect(ids(r.unchecked)).toContain('InnoDB buffer pool size');
	});
	it('reports evaluation problems instead of throwing', () => {
		const r = runAdvisor(input({ status: { ...status, Connections: '0' } }));
		expect(r.errors.some((e) => e.includes('Division by zero'))).toBe(true);
		expect(r.errors[0]).toMatch(/^Failed calculating value for rule '.+'\. Error when evaluating:/);
	});
	it('reports missing variables', () => {
		const { Uptime: _u, ...rest } = status;
		void _u;
		const r = runAdvisor(input({ status: rest }));
		expect(r.errors.some((e) => e.includes('Variable "Uptime" is not valid'))).toBe(true);
	});
	it('legacy rules: query cache fires on MySQL 5.7 and fired() chains', () => {
		const r = runAdvisor(
			input({ versionInt: 50700, variables: { ...variables, version: '5.7.30' } })
		);
		expect(ids(r.fired)).toContain('Query cache disabled');
		// dependants are not applicable
		expect(ids(r.unchecked)).toContain('Query Cache usage');
		expect(r.errors.filter((e) => e.includes('query_cache') && e.includes('rule'))).toEqual([]);
	});
	it('works with custom rules', () => {
		const r = runAdvisor(
			input({
				rules: [
					{
						id: 'x',
						name: 'x',
						formula: 'Questions / Uptime',
						test: 'value > 1',
						issue: 'i',
						recommendation: 'r',
						justification: '%s q/s',
						justification_formula: 'round(value, 1)'
					}
				]
			})
		);
		expect(r.fired[0].justification).toBe('5 q/s');
	});
});

describe('rule text helpers', () => {
	it('links variables and external links', () => {
		const html = ruleHtml(
			'raise {long_query_time} see <a href="https://x.test/a">docs</a>',
			(n) => `/v?filter=${n}`
		);
		expect(html).toContain('<a href="/v?filter=long_query_time">long_query_time</a>');
		expect(html).toContain('target="_blank" rel="noopener noreferrer"');
	});
	it('plain text', () => {
		expect(ruleText('set {a} <b>now</b>')).toBe('set a now');
	});
});
