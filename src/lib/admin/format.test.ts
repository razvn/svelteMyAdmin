import { describe, expect, it } from 'vitest';
import {
	formatByteDown,
	formatBytes,
	formatNumber,
	numberFormat,
	timespanFormat,
	truncate
} from './format';

describe('numberFormat', () => {
	it('groups thousands', () => {
		expect(numberFormat(1234567)).toBe('1,234,567');
		expect(numberFormat(-1234.5, 2)).toBe('-1,234.50');
		expect(numberFormat(0.001, 1)).toBe('0.0');
	});
});

describe('formatNumber (Util::formatNumber docs)', () => {
	it('matches the documented examples', () => {
		expect(formatNumber(123456789, 6)).toBe('123,457 k');
		expect(formatNumber(-123456789, 4, 2)).toBe('-123.46 M');
		expect(formatNumber(-0.003, 6)).toBe('-3,000 µ');
		expect(formatNumber(0.003, 3, 3)).toBe('3 m');
		expect(formatNumber(0.00003, 3, 2)).toBe('30 µ');
		expect(formatNumber(0, 6)).toBe('0');
	});
	it('K/M/G prefixes', () => {
		expect(formatNumber(1500000, 3)).toBe('2 M');
		expect(formatNumber(2_500_000_000, 3)).toBe('3 G');
		expect(formatNumber(12, 3)).toBe('12  ');
	});
	it('digitsLeft 0 only formats', () => {
		expect(formatNumber(1234567, 0)).toBe('1,234,567');
		expect(formatNumber('42', 0)).toBe('42');
	});
});

describe('formatByteDown', () => {
	it('keeps small values in bytes', () => {
		expect(formatByteDown(512)).toEqual(['512', 'B']);
		expect(formatByteDown(null)).toBeNull();
	});
	it('scales to binary units', () => {
		expect(formatByteDown(1024 * 1024 * 5, 3, 1)).toEqual(['5.0', 'MiB']);
		expect(formatByteDown(1536, 3, 1)).toEqual(['1.5', 'KiB']);
		expect(formatByteDown(2 * 1024 ** 3, 3, 1)).toEqual(['2.0', 'GiB']);
	});
	it('formatBytes joins', () => {
		expect(formatBytes(1536)).toBe('1.5 KiB');
		expect(formatBytes(10)).toBe('10 B');
	});
});

describe('timespanFormat', () => {
	it('splits into days/hours/minutes/seconds', () => {
		expect(timespanFormat(93784)).toBe('1 days, 2 hours, 3 minutes and 4 seconds');
		expect(timespanFormat(59)).toBe('0 days, 0 hours, 0 minutes and 59 seconds');
	});
});

describe('truncate', () => {
	it('adds an ellipsis only when needed', () => {
		expect(truncate('abcdef', 3)).toBe('abc…');
		expect(truncate('abc', 3)).toBe('abc');
	});
});
