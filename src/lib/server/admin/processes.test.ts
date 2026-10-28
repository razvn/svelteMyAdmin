import { describe, expect, it } from 'vitest';
import { mapProcessRow, parseProcessId } from './processes';

describe('parseProcessId', () => {
	it('accepts positive integers only', () => {
		expect(parseProcessId('42')).toBe(42);
		expect(parseProcessId(7)).toBe(7);
		for (const bad of ['0', '-1', '1; DROP', '1.5', '', ' 3', 'abc', null, undefined, {}]) {
			expect(parseProcessId(bad)).toBeNull();
		}
	});
});

describe('mapProcessRow', () => {
	it('normalises nulls and optional progress', () => {
		expect(
			mapProcessRow({
				Id: 3,
				User: 'root',
				Host: 'h',
				db: null,
				Command: 'Sleep',
				Time: 5,
				State: null,
				Info: null
			})
		).toEqual({
			id: 3,
			user: 'root',
			host: 'h',
			db: null,
			command: 'Sleep',
			time: 5,
			state: '',
			info: null,
			progress: null
		});
		expect(mapProcessRow({ Id: 1, Progress: '12.5', Info: 'SELECT 1' }).progress).toBe(12.5);
	});
});
