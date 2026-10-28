import { describe, expect, it } from 'vitest';
import { formatSi, numberFormat, timespanFormat, truncate } from './format';

describe('numberFormat', () => {
	it('groups thousands', () => {
		expect(numberFormat(1234567)).toBe('1,234,567');
		expect(numberFormat(-1234.5, 2)).toBe('-1,234.50');
		expect(numberFormat(0.001, 1)).toBe('0.0');
	});
});

describe('formatNumber (Util::formatNumber docs)', () => {
	it('matches the documented examples', () => {
		expect(formatSi(123456789, 6)).toBe('123,457 k');
		expect(formatSi(-123456789, 4, 2)).toBe('-123.46 M');
		expect(formatSi(-0.003, 6)).toBe('-3,000 µ');
		expect(formatSi(0.003, 3, 3)).toBe('3 m');
		expect(formatSi(0.00003, 3, 2)).toBe('30 µ');
		expect(formatSi(0, 6)).toBe('0');
	});
	it('K/M/G prefixes', () => {
		expect(formatSi(1500000, 3)).toBe('2 M');
		expect(formatSi(2_500_000_000, 3)).toBe('3 G');
		expect(formatSi(12, 3)).toBe('12  ');
	});
	it('digitsLeft 0 only formats', () => {
		expect(formatSi(1234567, 0)).toBe('1,234,567');
		expect(formatSi('42', 0)).toBe('42');
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
