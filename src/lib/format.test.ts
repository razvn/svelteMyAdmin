import { describe, expect, it } from 'vitest';
import { formatByteDown, formatBytes, formatNumber, formatUptimeShort } from './format.ts';

describe('formatNumber', () => {
	it('groups thousands', () => {
		expect(formatNumber(0)).toBe('0');
		expect(formatNumber(1234567)).toBe('1,234,567');
		expect(formatNumber('42')).toBe('42');
	});
});

describe('formatByteDown / formatBytes (databases page: limes 3, comma 1)', () => {
	it('matches phpMyAdmin output', () => {
		expect(formatBytes(0)).toBe('0 B');
		expect(formatBytes(999)).toBe('999 B');
		expect(formatBytes(1000)).toBe('1.0 KiB');
		expect(formatBytes(16384)).toBe('16.0 KiB');
		expect(formatBytes(1536)).toBe('1.5 KiB');
		expect(formatBytes(1048576)).toBe('1.0 MiB');
		expect(formatBytes(5 * 1024 * 1024 * 1024)).toBe('5.0 GiB');
		expect(formatBytes(3 * 1024 ** 4)).toBe('3.0 TiB');
	});
	it('uses limes 6 / comma 0 by default', () => {
		expect(formatByteDown(16384)).toEqual(['16,384', 'B']);
		expect(formatByteDown(5_000_000)).toEqual(['4,883', 'KiB']);
	});
	it('handles null and strings', () => {
		expect(formatByteDown(null)).toBeNull();
		expect(formatBytes(null)).toBe('');
		expect(formatBytes('16384')).toBe('16.0 KiB');
	});
});

describe('formatUptimeShort', () => {
	it('keeps the two most significant units', () => {
		expect(formatUptimeShort(42)).toBe('42s');
		expect(formatUptimeShort(125)).toBe('2m 5s');
		expect(formatUptimeShort(3 * 3600 + 120)).toBe('3h 2m');
		expect(formatUptimeShort(3 * 86400 + 4 * 3600 + 59)).toBe('3d 4h');
		expect(formatUptimeShort(-5)).toBe('0s');
	});
});
