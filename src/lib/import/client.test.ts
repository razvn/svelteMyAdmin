import { describe, expect, it } from 'vitest';
import { importUrl, parseEvents } from './client.ts';
import { defaultOptionValues, optionsFor } from './options.ts';

describe('import client helpers', () => {
	it('builds the endpoint URL per scope', () => {
		expect(importUrl({ level: 'server' })).toBe('/api/import');
		expect(importUrl({ level: 'db', db: 'a b' })).toBe('/api/import?db=a+b');
		expect(importUrl({ level: 'table', db: 'd', table: 't' })).toBe('/api/import?db=d&table=t');
	});

	it('parses NDJSON events and keeps the incomplete tail', () => {
		const a = parseEvents('{"t":"progress","bytes":1,"queries":2,"ms":3}\n{"t":"do');
		expect(a.events).toEqual([{ t: 'progress', bytes: 1, queries: 2, ms: 3 }]);
		expect(a.rest).toBe('{"t":"do');
		const b = parseEvents(a.rest + 'ne"}\nnot json\n');
		expect(b.events).toEqual([{ t: 'done' }]);
		expect(b.rest).toBe('');
	});
});

describe('option definitions', () => {
	it('depend on the level', () => {
		const names = (l: 'server' | 'db' | 'table') => optionsFor('csv', l).map((o) => o.name);
		expect(names('table')).toContain('truncate');
		expect(names('table')).toContain('columns');
		expect(names('table')).not.toContain('new_tbl_name');
		expect(names('db')).toContain('new_tbl_name');
		expect(names('db')).not.toContain('new_db_name');
		expect(names('server')).toContain('new_db_name');
	});

	it('defaults come from config.default.php and can be overridden by Import.<format>_<name>', () => {
		expect(defaultOptionValues('csv', 'table')).toMatchObject({
			terminated: ',',
			enclosed: '"',
			escaped: '"',
			new_line: 'auto',
			col_names: false
		});
		expect(defaultOptionValues('ldi', 'table')).toMatchObject({ terminated: ';', escaped: '\\' });
		expect(defaultOptionValues('ods', 'db')).toMatchObject({ empty_rows: true, col_names: false });
		expect(
			defaultOptionValues('csv', 'db', { csv_terminated: ';', csv_col_names: true })
		).toMatchObject({
			terminated: ';',
			col_names: true
		});
	});
});
