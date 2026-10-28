import { describe, expect, it } from 'vitest';
import {
	exportFilename,
	expandUserString,
	finalFilename,
	sanitizeFilename,
	strftime
} from './filename.ts';

const now = new Date(2026, 2, 5, 14, 7, 9); // 5 March 2026 14:07:09 local

describe('strftime', () => {
	it('expands the common conversions', () => {
		expect(strftime('%Y-%m-%d %H:%M:%S', now)).toBe('2026-03-05 14:07:09');
		expect(strftime('%y%b%e|%I%p|%j|%%', now)).toBe('26Mar 5|02PM|064|%');
		expect(strftime('%B %A', now)).toBe('March Thursday');
	});
	it('leaves unknown conversions alone', () => {
		expect(strftime('%Q', now)).toBe('%Q');
	});
});

describe('expandUserString', () => {
	const vars = {
		server: 'db.local',
		verbose: 'Prod',
		database: 'shop',
		table: 'orders',
		app: 'svelteMyAdmin 1'
	};
	it('replaces tokens after strftime', () => {
		expect(expandUserString('@DATABASE@_@TABLE@_%Y', vars, now)).toBe('shop_orders_2026');
		expect(
			expandUserString('@SERVER@/@VERBOSE@/@VSERVER@/__DB__/__TABLE__/__SERVER__', vars, now)
		).toBe('db.local/Prod/Prod/shop/orders/db.local');
	});
	it('falls back to the host for @VSERVER@ and never interprets % in values', () => {
		expect(expandUserString('@VSERVER@-@DATABASE@', { server: 'h', database: '%Y' }, now)).toBe(
			'h-%Y'
		);
	});
});

describe('file names', () => {
	it('sanitizes everything but [A-Za-z0-9_-] (dots included)', () => {
		expect(sanitizeFilename('my db.v1/../x y')).toBe('my_db_v1____x_y');
	});
	it('adds extension and compression suffix once', () => {
		expect(finalFilename('dump', 'sql', 'text/x-sql', 'none')).toEqual({
			filename: 'dump.sql',
			mimeType: 'text/x-sql'
		});
		expect(finalFilename('dump.SQL', 'sql', 'text/x-sql', 'gzip')).toEqual({
			filename: 'dump.SQL.gz',
			mimeType: 'application/x-gzip'
		});
		expect(finalFilename('dump', 'csv', 'text/csv', 'zip').filename).toBe('dump.csv.zip');
	});
	it('runs the whole pipeline', () => {
		expect(
			exportFilename(
				'@DATABASE@-%Y',
				{ server: 'h', database: 'a.b' },
				'sql',
				'text/x-sql',
				'none',
				now
			).filename
		).toBe('a_b-2026.sql');
		expect(exportFilename('', { server: 'h' }, 'sql', 'text/x-sql', 'none', now).filename).toBe(
			'export.sql'
		);
	});
});
