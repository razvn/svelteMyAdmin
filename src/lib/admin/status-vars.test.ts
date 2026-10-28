import { describe, expect, it } from 'vitest';
import {
	buildVariables,
	calculateValues,
	cleanDeprecated,
	filterVariables,
	getAlerts,
	sectionOf,
	usedCategories
} from './status-vars';

describe('sectionOf', () => {
	it('maps prefixes to sections', () => {
		expect(sectionOf('Com_select')).toBe('com');
		expect(sectionOf('Innodb_rows_read')).toBe('innodb');
		expect(sectionOf('Slow_launch_threads')).toBe('threads');
		expect(sectionOf('Slow_queries')).toBe('query');
		expect(sectionOf('Created_tmp_tables')).toBe('created_tmp');
		expect(sectionOf('Ssl_version')).toBe('ssl');
		expect(sectionOf('Uptime')).toBe('other');
	});
});

describe('cleanDeprecated', () => {
	it('drops aliases only when the replacement exists', () => {
		expect(cleanDeprecated({ Com_prepare_sql: '1', Com_stmt_prepare: '2' })).toEqual({
			Com_stmt_prepare: '2'
		});
		expect(cleanDeprecated({ Com_prepare_sql: '1' })).toEqual({ Com_prepare_sql: '1' });
	});
});

describe('calculateValues', () => {
	it('computes ratios', () => {
		const out = calculateValues(
			{ Key_reads: '1', Key_read_requests: '100', Threads_created: '5', Connections: '100' },
			{}
		);
		expect(out['Key_read_ratio_%']).toBe('1');
		expect(out['Threads_cache_hitrate_%']).toBe('95');
	});
	it('skips on zero denominators', () => {
		const out = calculateValues({ Key_reads: '1', Key_read_requests: '0' }, {});
		expect('Key_read_ratio_%' in out).toBe(false);
	});
});

describe('alerts', () => {
	it('flags values above threshold', () => {
		const vars = buildVariables(
			{ Aborted_clients: '3', Aborted_connects: '0', Uptime: '9', Threads_cached: '8' },
			{ thread_cache_size: '8' },
			{ Uptime: 'x' }
		);
		const by = Object.fromEntries(vars.map((v) => [v.name, v]));
		expect(by.Aborted_clients).toMatchObject({ hasAlert: true, isAlert: true });
		expect(by.Aborted_connects).toMatchObject({ hasAlert: true, isAlert: false });
		expect(by.Uptime).toMatchObject({ hasAlert: false, description: 'x' });
		expect(by.Threads_cached.isAlert).toBe(true);
	});
	it('thresholds depend on other values', () => {
		expect(getAlerts({ Key_read_requests: '1000' }, {}).Key_reads).toBe(10);
	});
});

describe('filterVariables', () => {
	const vars = buildVariables(
		{ Com_select: '1', Aborted_clients: '2', Innodb_rows_read: '9' },
		{},
		{}
	);
	it('filters by text, category and alerts', () => {
		const none = { text: '', category: '', onlyAlerts: false };
		expect(filterVariables(vars, { ...none, text: 'rows read' })).toHaveLength(1);
		expect(filterVariables(vars, { ...none, category: 'com' })).toHaveLength(1);
		expect(filterVariables(vars, { ...none, onlyAlerts: true })[0].name).toBe('Aborted_clients');
	});
	it('lists used categories in order', () => {
		expect(usedCategories(vars).map((c) => c.id)).toEqual(['com', 'innodb', 'other']);
	});
});
