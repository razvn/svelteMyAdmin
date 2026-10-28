import { format } from 'mysql2';
import { describe, expect, it } from 'vitest';
import { BYTE_VARIABLE_NAMES } from './byte-variables.ts';
import {
	VariableError,
	buildSetGlobalStatement,
	buildVariableRows,
	formatVariableValue,
	isByteVariable,
	isValidVariableName,
	parseVariableInput,
	variableErrorMessage
} from './variables.ts';

describe('byte formatting (shared formatBytes with phpMyAdmin (3, 3))', () => {
	it('picks the largest unit and keeps three decimals', () => {
		expect(formatVariableValue('key_buffer_size', '134217728').text).toBe('128.000 MiB');
		expect(formatVariableValue('key_buffer_size', '16777216').text).toBe('16.000 MiB');
		expect(formatVariableValue('key_buffer_size', '1572864').text).toBe('1.500 MiB');
		expect(formatVariableValue('key_buffer_size', '1024').text).toBe('1.000 KiB');
		expect(formatVariableValue('key_buffer_size', String(1024 ** 3))).toEqual({
			text: '1.000 GiB',
			title: String(1024 ** 3)
		});
	});

	it('shows plain bytes without decimals', () => {
		expect(formatVariableValue('key_buffer_size', '0').text).toBe('0 B');
		expect(formatVariableValue('key_buffer_size', '512').text).toBe('512 B');
	});
});

describe('isByteVariable', () => {
	it('uses the byte list, case-insensitively', () => {
		expect(isByteVariable('innodb_buffer_pool_size')).toBe(true);
		expect(isByteVariable('KEY_BUFFER_SIZE')).toBe(true);
		expect(isByteVariable('wsrep_received_bytes')).toBe(true);
		expect(isByteVariable('max_connect_errors')).toBe(false);
	});

	it('contains the knowledge-base entries', () => {
		expect(BYTE_VARIABLE_NAMES.size).toBeGreaterThanOrEqual(25);
		expect(BYTE_VARIABLE_NAMES.has('tokudb_cachetable_size_limit')).toBe(true);
	});
});

describe('formatVariableValue', () => {
	it('formats byte variables and keeps the raw value as title', () => {
		expect(formatVariableValue('innodb_buffer_pool_size', '134217728')).toEqual({
			text: '128.000 MiB',
			title: '134217728'
		});
	});

	it('groups plain integers and leaves text alone', () => {
		expect(formatVariableValue('max_connect_errors', '100')).toEqual({ text: '100' });
		expect(formatVariableValue('max_connections', '151000')).toEqual({ text: '151,000' });
		expect(formatVariableValue('version_comment', '8.4.13')).toEqual({ text: '8.4.13' });
		expect(formatVariableValue('sql_mode', 'STRICT_TRANS_TABLES')).toEqual({
			text: 'STRICT_TRANS_TABLES'
		});
		expect(formatVariableValue('max_connections', '-5')).toEqual({ text: '-5' });
	});

	it('does not format a non-numeric value of a byte variable', () => {
		expect(formatVariableValue('key_buffer_size', 'ON')).toEqual({ text: 'ON' });
	});
});

describe('isValidVariableName', () => {
	const known = new Set(['max_connect_errors', 'sql_mode']);

	it('accepts only names of the real variable list', () => {
		expect(isValidVariableName('max_connect_errors', known)).toBe(true);
		expect(isValidVariableName('no_such_variable', known)).toBe(false);
		expect(isValidVariableName('MAX_CONNECT_ERRORS', known)).toBe(false);
	});

	it('rejects anything that is not a plain identifier', () => {
		expect(isValidVariableName('sql_mode`; DROP', new Set(['sql_mode`; DROP']))).toBe(false);
		expect(isValidVariableName('a b', new Set(['a b']))).toBe(false);
		expect(isValidVariableName('', known)).toBe(false);
	});
});

describe('parseVariableInput', () => {
	it('converts byte input for byte variables', () => {
		expect(parseVariableInput('key_buffer_size', '128 MB')).toBe(128 * 1024 ** 2);
		expect(parseVariableInput('key_buffer_size', ' 2gib ')).toBe(2 * 1024 ** 3);
		expect(parseVariableInput('key_buffer_size', '512 KB')).toBe(512 * 1024);
	});

	it('does not convert byte input for other variables', () => {
		expect(parseVariableInput('max_connect_errors', '128 MB')).toBe('128 MB');
	});

	it('returns numbers for numeric input and strings otherwise', () => {
		expect(parseVariableInput('max_connect_errors', ' 200 ')).toBe(200);
		expect(parseVariableInput('long_query_time', '1.5')).toBe(1.5);
		expect(parseVariableInput('sql_mode', 'ONLY_FULL_GROUP_BY')).toBe('ONLY_FULL_GROUP_BY');
		expect(parseVariableInput('x', '18446744073709551615')).toBe('18446744073709551615');
	});
});

describe('buildSetGlobalStatement', () => {
	it('quotes the name and uses a placeholder for the value', () => {
		expect(buildSetGlobalStatement('max_connect_errors', 200)).toEqual({
			sql: 'SET GLOBAL `max_connect_errors` = ?',
			params: [200]
		});
	});

	it('sends numbers unquoted and other values quoted and escaped', () => {
		const numeric = buildSetGlobalStatement('max_connect_errors', 200);
		expect(format(numeric.sql, numeric.params)).toBe('SET GLOBAL `max_connect_errors` = 200');
		const text = buildSetGlobalStatement('sql_mode', "it's");
		expect(format(text.sql, text.params)).toBe("SET GLOBAL `sql_mode` = 'it\\'s'");
	});

	it('refuses names that are not plain identifiers', () => {
		expect(() => buildSetGlobalStatement('a`b', 1)).toThrow(VariableError);
		expect(() => buildSetGlobalStatement('a b', 1)).toThrow(VariableError);
	});
});

describe('buildVariableRows', () => {
	it('adds a session value only when it differs from the global one', () => {
		const globals = new Map([
			['max_connect_errors', '100'],
			['sql_mode', 'STRICT'],
			['tmp_table_size', '16777216']
		]);
		const sessions = new Map([
			['max_connect_errors', '100'],
			['sql_mode', ''],
			['tmp_table_size', '33554432']
		]);
		const rows = buildVariableRows(globals, sessions);
		expect(rows).toEqual([
			{ name: 'max_connect_errors', value: '100', display: '100', sessionDisplay: null },
			{ name: 'sql_mode', value: 'STRICT', display: 'STRICT', sessionDisplay: '' },
			{
				name: 'tmp_table_size',
				value: '16777216',
				display: '16.000 MiB',
				title: '16777216',
				sessionDisplay: '32.000 MiB',
				sessionTitle: '33554432'
			}
		]);
	});

	it('has no session value when the session list lacks the variable', () => {
		const rows = buildVariableRows(new Map([['a', '1']]), new Map());
		expect(rows[0].sessionDisplay).toBeNull();
	});
});

describe('variableErrorMessage', () => {
	it('shows the MySQL message only', () => {
		const err = Object.assign(new Error('Variable is read only'), {
			sqlMessage: "Variable 'version' is a read only variable",
			sql: 'SET GLOBAL ...'
		});
		expect(variableErrorMessage(err)).toBe("Variable 'version' is a read only variable");
	});

	it('falls back to a generic text and keeps our own messages', () => {
		expect(variableErrorMessage(new Error('boom'))).toBe('Setting the variable failed.');
		expect(variableErrorMessage(new VariableError("Unknown variable 'x'."))).toBe(
			"Unknown variable 'x'."
		);
	});
});
