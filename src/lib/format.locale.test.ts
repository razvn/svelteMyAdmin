import { describe, expect, it } from 'vitest';
import {
	formatBytes,
	formatDate,
	formatNumber,
	formatSi,
	monthNames,
	numberFormat,
	timespanFormat,
	type LocaleFormat
} from './format.ts';

const fr: LocaleFormat = {
	locale: 'fr',
	thousands: ' ',
	decimal: ',',
	units: ['o', 'kio', 'Mio', 'Gio', 'Tio', 'Pio', 'Eio']
};

describe('locale-aware formatting', () => {
	it('keeps the English output by default', () => {
		expect(formatNumber(1234567)).toBe('1,234,567');
		expect(formatBytes(16384)).toBe('16.0 KiB');
		expect(formatSi(1234567.891, 0, 2)).toBe('1,234,567.89');
	});
	it('localises separators and units', () => {
		expect(formatNumber(1234567, fr)).toBe('1 234 567');
		expect(numberFormat(1234.5, 1, fr)).toBe('1 234,5');
		expect(formatBytes(16384, 3, 1, fr)).toBe('16,0 kio');
		expect(formatBytes(512, 3, 1, fr)).toBe('512 o');
		expect(formatSi(1234567.891, 0, 2, false, true, fr)).toBe('1 234 567,89');
	});
	it('uses a localised duration sentence when provided', () => {
		expect(timespanFormat(90061)).toBe('1 days, 1 hours, 1 minutes and 1 seconds');
		expect(timespanFormat(61, { ...fr, timespan: (d, h, m, s) => `${m}m${s}s` })).toBe('1m1s');
	});
	it('formats dates through Intl', () => {
		const d = new Date(Date.UTC(2026, 9, 29, 12));
		expect(formatDate(d, 'en', 'long')).toBe('October 29, 2026');
		expect(formatDate(d, fr, 'long')).toBe('29 octobre 2026');
		expect(formatDate('nope')).toBe('');
		expect(monthNames('es')[2]).toBe('marzo');
	});
});
