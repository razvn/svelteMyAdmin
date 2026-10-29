/**
 * Date helpers of the Dateformat transformation: strftime() for the "local" mode and PHP's
 * gmdate() for "utc", plus the input parsing of DateFormatTransformationsPlugin.
 */

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
];
const pad = (n: number, len = 2, ch = '0') => String(n).padStart(len, ch);

interface Parts {
	year: number;
	month: number; // 0-11
	day: number;
	hour: number;
	minute: number;
	second: number;
	weekday: number; // 0 = Sunday
	/** Offset from UTC in minutes (east positive). */
	offset: number;
	zone: string;
}

function parts(ts: number, utc: boolean): Parts {
	const d = new Date(ts * 1000);
	if (utc) {
		return {
			year: d.getUTCFullYear(),
			month: d.getUTCMonth(),
			day: d.getUTCDate(),
			hour: d.getUTCHours(),
			minute: d.getUTCMinutes(),
			second: d.getUTCSeconds(),
			weekday: d.getUTCDay(),
			offset: 0,
			zone: 'UTC'
		};
	}
	const zone = /\(([^)]+)\)/.exec(d.toString())?.[1] ?? '';
	return {
		year: d.getFullYear(),
		month: d.getMonth(),
		day: d.getDate(),
		hour: d.getHours(),
		minute: d.getMinutes(),
		second: d.getSeconds(),
		weekday: d.getDay(),
		offset: -d.getTimezoneOffset(),
		zone: zone.split(' ').length > 1 ? zone.replace(/[a-z\s]/g, '') : zone
	};
}

function dayOfYear(p: Parts): number {
	return Math.round((Date.UTC(p.year, p.month, p.day) - Date.UTC(p.year, 0, 1)) / 86400000);
}

function isoWeek(p: Parts): { week: number; year: number } {
	const date = new Date(Date.UTC(p.year, p.month, p.day));
	const dow = (date.getUTCDay() + 6) % 7;
	date.setUTCDate(date.getUTCDate() - dow + 3);
	const year = date.getUTCFullYear();
	const firstThursday = new Date(Date.UTC(year, 0, 4));
	const week =
		1 +
		Math.round(
			((date.getTime() - firstThursday.getTime()) / 86400000 -
				3 +
				((firstThursday.getUTCDay() + 6) % 7)) /
				7
		);
	return { week, year };
}

const hour12 = (h: number) => h % 12 || 12;
const offsetText = (minutes: number, colon: boolean) => {
	const sign = minutes < 0 ? '-' : '+';
	const abs = Math.abs(minutes);
	return `${sign}${pad(Math.floor(abs / 60))}${colon ? ':' : ''}${pad(abs % 60)}`;
};

/** strftime() with the specifiers phpMyAdmin's Util::localisedDate users rely on. Unknown ones stay. */
export function strftime(ts: number, format: string): string {
	const p = parts(ts, false);
	const spec = (c: string): string | null => {
		switch (c) {
			case 'a':
				return DAYS[p.weekday].slice(0, 3);
			case 'A':
				return DAYS[p.weekday];
			case 'b':
			case 'h':
				return MONTHS[p.month].slice(0, 3);
			case 'B':
				return MONTHS[p.month];
			case 'c':
				return `${spec('a')} ${spec('b')} ${pad(p.day, 2, ' ')} ${spec('T')} ${p.year}`;
			case 'C':
				return pad(Math.floor(p.year / 100));
			case 'd':
				return pad(p.day);
			case 'D':
				return `${pad(p.month + 1)}/${pad(p.day)}/${pad(p.year % 100)}`;
			case 'e':
				return pad(p.day, 2, ' ');
			case 'F':
				return `${p.year}-${pad(p.month + 1)}-${pad(p.day)}`;
			case 'g':
				return pad(isoWeek(p).year % 100);
			case 'G':
				return String(isoWeek(p).year);
			case 'H':
				return pad(p.hour);
			case 'I':
				return pad(hour12(p.hour));
			case 'j':
				return pad(dayOfYear(p) + 1, 3);
			case 'k':
				return pad(p.hour, 2, ' ');
			case 'l':
				return pad(hour12(p.hour), 2, ' ');
			case 'm':
				return pad(p.month + 1);
			case 'M':
				return pad(p.minute);
			case 'n':
				return '\n';
			case 'p':
				return p.hour < 12 ? 'AM' : 'PM';
			case 'P':
				return p.hour < 12 ? 'am' : 'pm';
			case 'r':
				return `${spec('I')}:${spec('M')}:${spec('S')} ${spec('p')}`;
			case 'R':
				return `${pad(p.hour)}:${pad(p.minute)}`;
			case 's':
				return String(Math.floor(ts));
			case 'S':
				return pad(p.second);
			case 't':
				return '\t';
			case 'T':
			case 'X':
				return `${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}`;
			case 'u':
				return String(p.weekday === 0 ? 7 : p.weekday);
			case 'U':
				return pad(Math.floor((dayOfYear(p) + 7 - p.weekday) / 7));
			case 'V':
				return pad(isoWeek(p).week);
			case 'w':
				return String(p.weekday);
			case 'W':
				return pad(Math.floor((dayOfYear(p) + 7 - ((p.weekday + 6) % 7)) / 7));
			case 'x':
				return `${pad(p.month + 1)}/${pad(p.day)}/${pad(p.year % 100)}`;
			case 'y':
				return pad(p.year % 100);
			case 'Y':
				return String(p.year);
			case 'z':
				return offsetText(p.offset, false);
			case 'Z':
				return p.zone;
			case '%':
				return '%';
			default:
				return null;
		}
	};
	return format.replace(/%(.)/gs, (m, c: string) => spec(c) ?? m);
}

const ordinal = (n: number): string => {
	if (n % 100 >= 11 && n % 100 <= 13) return 'th';
	return ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
};

/** PHP gmdate() for the commonly used format characters. */
export function gmdate(format: string, ts: number): string {
	const p = parts(ts, true);
	const leap = (p.year % 4 === 0 && p.year % 100 !== 0) || p.year % 400 === 0;
	const spec = (c: string): string | null => {
		switch (c) {
			case 'd':
				return pad(p.day);
			case 'D':
				return DAYS[p.weekday].slice(0, 3);
			case 'j':
				return String(p.day);
			case 'l':
				return DAYS[p.weekday];
			case 'N':
				return String(p.weekday === 0 ? 7 : p.weekday);
			case 'S':
				return ordinal(p.day);
			case 'w':
				return String(p.weekday);
			case 'z':
				return String(dayOfYear(p));
			case 'W':
				return pad(isoWeek(p).week);
			case 'F':
				return MONTHS[p.month];
			case 'm':
				return pad(p.month + 1);
			case 'M':
				return MONTHS[p.month].slice(0, 3);
			case 'n':
				return String(p.month + 1);
			case 't':
				return String(new Date(Date.UTC(p.year, p.month + 1, 0)).getUTCDate());
			case 'L':
				return leap ? '1' : '0';
			case 'o':
				return String(isoWeek(p).year);
			case 'Y':
				return String(p.year);
			case 'y':
				return pad(p.year % 100);
			case 'a':
				return p.hour < 12 ? 'am' : 'pm';
			case 'A':
				return p.hour < 12 ? 'AM' : 'PM';
			case 'g':
				return String(hour12(p.hour));
			case 'G':
				return String(p.hour);
			case 'h':
				return pad(hour12(p.hour));
			case 'H':
				return pad(p.hour);
			case 'i':
				return pad(p.minute);
			case 's':
				return pad(p.second);
			case 'u':
				return '000000';
			case 'v':
				return '000';
			case 'e':
			case 'T':
				return 'UTC';
			case 'I':
			case 'Z':
				return '0';
			case 'O':
				return '+0000';
			case 'P':
			case 'p':
				return '+00:00';
			case 'U':
				return String(Math.floor(ts));
			case 'c':
				return gmdate('Y-m-d\\TH:i:sP', ts);
			case 'r':
				return gmdate('D, d M Y H:i:s O', ts);
			default:
				return null;
		}
	};
	let out = '';
	for (let i = 0; i < format.length; i++) {
		const c = format[i];
		if (c === '\\') {
			i++;
			if (i < format.length) out += format[i];
			continue;
		}
		out += spec(c) ?? c;
	}
	return out;
}

const mktime = (y: number, mo: number, d: number, h: number, mi: number, s: number): number =>
	Math.floor(new Date(y, mo - 1, d, h, mi, s).getTime() / 1000);

function checkdate(month: number, day: number, year: number): boolean {
	if (month < 1 || month > 12 || day < 1 || year < 1 || year > 32767) return false;
	const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
	const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
	return day <= days;
}

/** Minimal strtotime(): ISO-like dates/times, then whatever the JS parser accepts. -1 on failure. */
function strtotime(text: string): number {
	const s = text.trim();
	let m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/.exec(s);
	if (m) {
		const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
		if (y < 1970) return -1;
		return mktime(y, mo, d, Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
	}
	m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(s);
	if (m) {
		const now = new Date();
		return mktime(
			now.getFullYear(),
			now.getMonth() + 1,
			now.getDate(),
			Number(m[1]),
			Number(m[2]),
			Number(m[3] ?? 0)
		);
	}
	const t = Date.parse(s);
	return Number.isNaN(t) ? -1 : Math.floor(t / 1000);
}

/**
 * The timestamp DateFormatTransformationsPlugin derives from a value (-1 when it is none).
 * `isInt` columns hold unix timestamps.
 */
export function toTimestamp(buffer: string, isInt: boolean): number {
	let timestamp = -1;
	if (isInt) {
		timestamp = Number(buffer);
		if (Number.isNaN(timestamp)) timestamp = -1;
	} else if (/^(\d{2}){3,7}$/.test(buffer)) {
		const offset = buffer.length === 14 || buffer.length === 8 ? 4 : 2;
		const n = (from: number, len: number) => Number(buffer.substr(from, len) || 0);
		const [year, month, day] = [n(0, offset), n(offset, 2), n(offset + 2, 2)];
		if (checkdate(month, day, year)) {
			const full = year < 70 ? year + 2000 : year <= 100 ? year + 1900 : year;
			timestamp = mktime(full, month, day, n(offset + 4, 2), n(offset + 6, 2), n(offset + 8, 2));
		}
	} else if (/^[0-9]\d{1,9}$/.test(buffer)) {
		timestamp = Number.parseInt(buffer, 10);
	} else {
		timestamp = strtotime(buffer);
	}
	if (timestamp < 0 && /^[1-9]\d{1,9}$/.test(buffer)) timestamp = Number(buffer);
	return timestamp;
}
