import { describe, expect, it } from 'vitest';
import {
	ExpressionError,
	collectNames,
	evaluate,
	parse,
	tokenize,
	type Value
} from './expression.ts';
import { buildFunctions, byTime, phpRound, phpSubstr, vsprintf } from './functions.ts';

const fns = buildFunctions((id) => id === 'yes');
const run = (src: string, variables: Record<string, Value> = {}) =>
	evaluate(src, { variables, functions: fns });

describe('tokenizer', () => {
	it('splits numbers, strings, names and operators', () => {
		const t = tokenize(`a !==1.5 && 'x\\'y'`);
		expect(t.map((x) => x.value)).toEqual(['a', '!==', 1.5, '&&', "x'y", '']);
	});
	it('rejects unknown characters and unclosed strings', () => {
		expect(() => tokenize('a @ b')).toThrow(ExpressionError);
		expect(() => tokenize("'abc")).toThrow(/Unclosed/);
	});
});

describe('precedence', () => {
	it('multiplies before adding', () => expect(run('1 + 2 * 3')).toBe(7));
	it('honours parentheses', () => expect(run('(1 + 2) * 3')).toBe(9));
	it('is left associative for - and /', () => {
		expect(run('10 - 4 - 3')).toBe(3);
		expect(run('100 / 5 / 2')).toBe(10);
	});
	it('** is right associative', () => expect(run('2 ** 3 ** 2')).toBe(512));
	it('&& binds tighter than ||', () => expect(run('1 || 0 && 0')).toBe(true));
	it('comparison binds tighter than &&', () => expect(run('1 < 2 && 3 > 2')).toBe(true));
	it('! binds tighter than &&', () => expect(run('!0 && 0')).toBe(false));
	it('unary minus', () => expect(run('-3 + 5')).toBe(2));
	it('arithmetic binds tighter than comparison', () => expect(run('1 + 1 == 2')).toBe(true));
	it('ternary', () => expect(run('a > 1 ? "big" : "small"', { a: 2 })).toBe('big'));
});

describe('evaluation', () => {
	it('numeric strings behave as numbers', () => {
		expect(run('Slow / Q * 100', { Slow: '5', Q: '1000' })).toBe(0.5);
		expect(run('a < 10', { a: '9' })).toBe(true);
		expect(run('a == 0', { a: 'OFF' })).toBe(false);
		expect(run("a == 'OFF'", { a: 'OFF' })).toBe(true);
	});
	it('=== is strict', () => {
		expect(run('a === 0', { a: '0' })).toBe(false);
		expect(run('a === 0', { a: 0 })).toBe(true);
		expect(run("a === 'NEVER'", { a: 'NEVER' })).toBe(true);
	});
	it('string comparison like PHP 8', () => {
		expect(run("'8.' <= '5.'")).toBe(false);
		expect(run("'abc' < 'abd'")).toBe(true);
	});
	it('arrays', () => expect(run('[1, a, "x"]', { a: 2 })).toEqual([1, 2, 'x']));
	it('in operator', () => expect(run('2 in [1,2]')).toBe(true));
	it('concatenation', () => expect(run('"a" ~ 1')).toBe('a1'));
	it('short circuits', () => expect(run('0 && x')).toBe(false));
});

describe('errors', () => {
	it('division by zero', () => expect(() => run('1 / 0')).toThrow(/Division by zero/));
	it('unknown variable', () => expect(() => run('nope + 1')).toThrow(/"nope" is not valid/));
	it('unknown function', () => expect(() => run('eval("1")')).toThrow(/does not exist/));
	it('does not expose prototype members', () => {
		expect(() => run('constructor')).toThrow(ExpressionError);
		expect(() => run('toString()')).toThrow(ExpressionError);
	});
	it('non numeric string arithmetic', () =>
		expect(() => run('a * 2', { a: 'abc' })).toThrow(/Unsupported/));
	it('syntax errors', () => {
		expect(() => parse('1 +')).toThrow(/Unexpected token/);
		expect(() => parse('(1')).toThrow(ExpressionError);
		expect(() => parse('1 2')).toThrow(ExpressionError);
		expect(() => parse('f(1,')).toThrow(ExpressionError);
	});
});

describe('functions', () => {
	it('round with precision', () => {
		expect(run('round(value,2)', { value: 1.2349 })).toBe(1.23);
		expect(phpRound(2.5)).toBe(3);
		expect(phpRound(-2.5)).toBe(-3);
	});
	it('substr', () => {
		expect(run('substr(v,0,2)', { v: '5.1.30' })).toBe('5.');
		expect(phpSubstr('abc', 5, 1)).toBe('');
		expect(phpSubstr('abcdef', -2)).toBe('ef');
	});
	it('preg_match with delimiters and flags', () => {
		expect(run("preg_match('/PERCONA/i', v)", { v: 'Percona Server' })).toBe(1);
		expect(run("!preg_match('/64/', v)", { v: 'x86' })).toBe(true);
		expect(() => run("preg_match('abc', v)", { v: '' })).toThrow(ExpressionError);
	});
	it('fired', () => {
		expect(run("fired('yes')")).toBe('1');
		expect(run("!fired('no')")).toBe(true);
	});
	it('timespan and bytes', () => {
		expect(run('ADVISOR_timespanFormat(90061)')).toBe('1 days, 1 hours, 1 minutes and 1 seconds');
		expect(run('ADVISOR_formatByteDown(v, 2, 2)', { v: 134217728 })).toBe('0.13 GiB');
	});
	it('byTime', () => {
		expect(byTime(2, 2)).toBe('2 per second');
		expect(byTime(0.5, 2)).toBe('30 per minute');
		expect(byTime(0.001, 2)).toBe('3.6 per hour');
		expect(byTime(0.00000001, 2)).toBe('<0.01 per day');
	});
	it('vsprintf', () => {
		expect(vsprintf('%s%% of %d', [5.5, '7ms'])).toBe('5.5% of 7');
		expect(vsprintf('100%%', [])).toBe('100%');
		expect(() => vsprintf('%s', [])).toThrow(ExpressionError);
	});
});

describe('collectNames', () => {
	it('lists variables but not functions', () => {
		expect([...collectNames(parse('round(a / b, 2) > c && !fired("x")'))]).toEqual(['a', 'b', 'c']);
	});
});
