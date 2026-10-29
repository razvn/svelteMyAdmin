import { describe, expect, it } from 'vitest';
import { binaryToIp, inetNtop, inetPton, ipToBinary, ipToLong, longToIp } from './convert.ts';
import { gmdate, strftime, toTimestamp } from './format-date.ts';
import { INPUT_PLUGINS, phpRegex } from './input.ts';
import { getOptions, stripslashes, withDefaults } from './options.ts';
import { mbSubstr, OUTPUT_PLUGINS, prettyXml } from './output.ts';
import {
	inputKey,
	mimeTypes,
	mimeValue,
	normalizeKey,
	outputKey,
	resolveInput,
	resolveOutput
} from './registry.ts';
import type { OutputContext, Transformed } from './types.ts';

const ctx = (
	over: Partial<OutputContext['column']> = {},
	wrapper = 'http://w/'
): OutputContext => ({
	column: { name: 'c', isInt: false, isBinary: false, ...over },
	wrapper: (extra) => (wrapper ? wrapper + (extra ? `?${new URLSearchParams(extra)}` : '') : null),
	rowValue: (n) => (n === 'fname' ? 'report.pdf' : null)
});

function run(id: string, text: string, options: string[] = [], c = ctx(), bytes?: Uint8Array) {
	const plugin = OUTPUT_PLUGINS.find((p) => p.id === id);
	if (!plugin) throw new Error(`no plugin ${id}`);
	return plugin.apply({ text, bytes }, options, c);
}
const textOf = (t: Transformed) => (t.type === 'text' ? t.text : JSON.stringify(t));

describe('getOptions', () => {
	it('parses the documented example', () => {
		expect(getOptions("'option ,, quoted',abd,'2,3',")).toEqual([
			'option ,, quoted',
			'abd',
			'2,3',
			''
		]);
	});
	it('handles empty, spaces and escapes', () => {
		expect(getOptions('')).toEqual([]);
		expect(getOptions(' a , b')).toEqual([' a ', ' b']);
		expect(getOptions("'a\\'b'")).toEqual(["a'b"]);
		expect(getOptions("'\\\\xyz'")).toEqual(['\\xyz']);
		expect(getOptions('0,1')).toEqual(['0', '1']);
	});
	it('an unterminated quote swallows the rest', () => {
		expect(getOptions("'abc,def")).toEqual(['abc,de']);
		expect(getOptions("'")).toEqual(['']);
	});
	it('stripslashes and defaults', () => {
		expect(stripslashes('a\\\\b\\n\\0')).toBe('a\\bn\0');
		expect(withDefaults(['x', ''], ['T', 'F', 'z'])).toEqual(['x', 'F', 'z']);
		expect(withDefaults([], [null, 5])).toEqual([null, '5']);
	});
});

describe('address conversion', () => {
	it('ip <-> long', () => {
		expect(ipToLong('127.0.0.1')).toBe('2130706433');
		expect(ipToLong('255.255.255.255')).toBe('4294967295');
		expect(ipToLong('1.2.3')).toBe('1.2.3');
		expect(ipToLong('01.2.3.4')).toBe('01.2.3.4');
		expect(longToIp('2130706433')).toBe('127.0.0.1');
		expect(longToIp('4294967296')).toBe('4294967296');
		expect(longToIp('-1')).toBe('-1');
		expect(longToIp('abc')).toBe('abc');
	});
	it('inet_pton / inet_ntop', () => {
		expect(ipToBinary('127.0.0.1')).toBe('0x7f000001');
		expect(ipToBinary('::1')).toBe('0x00000000000000000000000000000001');
		expect(ipToBinary('2001:db8::ff00:42:8329')).toBe('0x20010db8000000000000ff0000428329');
		expect(ipToBinary('nope')).toBe('nope');
		expect(inetNtop(inetPton('2001:0db8:0000:0000:0000:ff00:0042:8329')!)).toBe(
			'2001:db8::ff00:42:8329'
		);
		expect(inetNtop(inetPton('::ffff:1.2.3.4')!)).toBe('::ffff:1.2.3.4');
		expect(inetNtop(inetPton('::')!)).toBe('::');
		expect(inetNtop(new Uint8Array(3))).toBeNull();
		expect(inetPton('1::2::3')).toBeNull();
	});
	it('binaryToIp', () => {
		expect(binaryToIp('0x7f000001', true)).toBe('127.0.0.1');
		expect(binaryToIp('plain', false)).toBe('plain');
		expect(binaryToIp('abc', true, Uint8Array.from([1, 2]))).toBe('0102');
		expect(binaryToIp('0xzz', true)).toBe('0xzz');
	});
});

describe('date formatting', () => {
	it('strftime with the default local format', () => {
		const ts = toTimestamp('2024-05-03 10:20:30', false);
		expect(strftime(ts, '%B %d, %Y at %I:%M %p')).toBe('May 03, 2024 at 10:20 AM');
		expect(strftime(ts, '%a %e %b %y %H:%M:%S %j %%')).toBe('Fri  3 May 24 10:20:30 124 %');
		expect(strftime(ts, '%q')).toBe('%q');
	});
	it('gmdate', () => {
		expect(gmdate('Y-m-d  H:i:s', 0)).toBe('1970-01-01  00:00:00');
		expect(gmdate('D, d M Y jS \\o\\f F', 86400 * 33)).toBe('Tue, 03 Feb 1970 3rd of February');
		expect(gmdate('N w z t L', 951782400)).toBe('2 2 59 29 1');
	});
	it('timestamp detection', () => {
		expect(toTimestamp('86400', true)).toBe(86400);
		expect(toTimestamp('1700000000', false)).toBe(1700000000);
		expect(toTimestamp('0000-00-00 00:00:00', false)).toBe(-1);
		expect(toTimestamp('garbage', false)).toBe(-1);
		const full = toTimestamp('20240503102030', false);
		expect(strftime(full, '%Y-%m-%d %H:%M:%S')).toBe('2024-05-03 10:20:30');
		const short = toTimestamp('240503102030', false);
		expect(strftime(short, '%Y-%m-%d %H:%M')).toBe('2024-05-03 10:20');
	});
	it('Dateformat plugin', () => {
		const c = ctx();
		expect(run('text_plain_dateformat', '2024-05-03 10:20:30', [], c)).toEqual({
			type: 'text',
			text: 'May 03, 2024 at 10:20 AM',
			title: '2024-05-03 10:20:30'
		});
		// offset in hours, utc: shifted by the local offset of the parse
		const local = new Date(2024, 4, 3, 10, 20, 30);
		const expected = gmdate('Y-m-d  H:i:s', Math.floor(local.getTime() / 1000) - 2 * 3600);
		expect(textOf(run('text_plain_dateformat', '2024-05-03 10:20:30', ['2', '', 'UTC'], c))).toBe(
			expected
		);
		expect(
			textOf(run('text_plain_dateformat', '2024-05-03 10:20:30', ['0', '', 'nonsense'], c))
		).toBe('INVALID DATE TYPE');
		expect(textOf(run('text_plain_dateformat', '0000-00-00', [], c))).toBe('0000-00-00');
		expect(
			textOf(run('text_plain_dateformat', '86400', ['0', 'Y-m-d', 'utc'], ctx({ isInt: true })))
		).toBe('1970-01-02');
	});
});

describe('output plugins', () => {
	it('Bool2Text', () => {
		expect(textOf(run('text_plain_bool2text', '1'))).toBe('T');
		expect(textOf(run('text_plain_bool2text', '0'))).toBe('F');
		expect(textOf(run('text_plain_bool2text', '0.0', getOptions("'yes','no'")))).toBe('no');
		expect(textOf(run('text_plain_bool2text', '5', ['yes', 'no']))).toBe('yes');
		expect(textOf(run('text_plain_bool2text', '0', ['yes', '']))).toBe('F');
	});
	it('Append / PreApPend', () => {
		expect(textOf(run('text_plain_preappend', 'x', ['<', '>']))).toBe('<x>');
		expect(textOf(run('text_plain_preappend', 'x'))).toBe('x');
	});
	it('Substring', () => {
		expect(textOf(run('text_plain_substring', 'abcdefgh', ['2', '3']))).toBe('…cde…');
		expect(textOf(run('text_plain_substring', 'abcdefgh', ['0', '3', '..']))).toBe('abc..');
		expect(textOf(run('text_plain_substring', 'abc', ['0', '10']))).toBe('abc');
		expect(textOf(run('text_plain_substring', 'abcdef', ['3']))).toBe('…def');
		expect(mbSubstr('äöü€x', -2)).toBe('€x');
		expect(mbSubstr('abc', 1, -1)).toBe('b');
	});
	it('Hex', () => {
		const bytes = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
		expect(textOf(run('application_octetstream_hex', '0xdeadbeef', [], ctx(), bytes))).toBe(
			'de ad be ef '
		);
		expect(textOf(run('application_octetstream_hex', 'ab', ['0']))).toBe('6162');
		expect(textOf(run('application_octetstream_hex', 'abc', ['4']))).toBe('6162 63 ');
	});
	it('Longtoipv4 and Binarytoip', () => {
		expect(textOf(run('text_plain_longtoipv4', '3232235777'))).toBe('192.168.1.1');
		expect(textOf(run('text_plain_binarytoip', '0x7f000001', [], ctx({ isBinary: true })))).toBe(
			'127.0.0.1'
		);
	});
	it('Link', () => {
		expect(run('text_plain_link', 'a.txt', ['https://x.test/', 'Title'])).toMatchObject({
			type: 'link',
			href: 'https://x.test/a.txt',
			text: 'Title'
		});
		expect(textOf(run('text_plain_link', 'javascript:alert(1)'))).toBe('javascript:alert(1)');
		expect(run('text_plain_link', 'ignored', ['https://x.test/fixed', '', 'true'])).toMatchObject({
			href: 'https://x.test/fixed'
		});
	});
	it('Imagelink / Formatted / Json / Xml / Sql / External', () => {
		expect(run('text_plain_imagelink', 'a.png', ['https://x.test/', '10', '20'])).toMatchObject({
			type: 'image',
			src: 'https://x.test/a.png',
			width: 10,
			height: 20
		});
		expect(run('text_plain_formatted', '<b class="x">hi</b>')).toEqual({
			type: 'frame',
			srcdoc: "<b class='x'>hi</b>"
		});
		expect(run('text_plain_json', '{"a":[1,2]}')).toMatchObject({
			type: 'code',
			language: 'json',
			text: '{\n  "a": [\n    1,\n    2\n  ]\n}'
		});
		expect(run('text_plain_json', 'not json')).toMatchObject({ text: 'not json' });
		expect(prettyXml('<a><b>1</b><c/></a>')).toBe('<a>\n  <b>1</b>\n  <c/>\n</a>');
		expect(run('text_plain_sql', 'select 1')).toMatchObject({ language: 'sql' });
		expect(run('text_plain_external', 'x')).toMatchObject({ type: 'text', text: 'x' });
	});
	it('images go through the wrapper', () => {
		const bytes = Uint8Array.from([1, 2, 3]);
		expect(run('image_png_inline', '0x010203', ['50', '40'], ctx(), bytes)).toEqual({
			type: 'image',
			src: 'http://w/',
			href: 'http://w/',
			alt: '[[BLOB - 3 B]]',
			width: 50,
			height: 40
		});
		expect(run('image_jpeg_link', '0x01', [], ctx(), bytes)).toMatchObject({
			type: 'link',
			text: '[BLOB]'
		});
		expect(run('image_png_inline', 'x', [], ctx({}, ''))).toMatchObject({ type: 'text' });
	});
	it('Download', () => {
		expect(run('application_octetstream_download', 'x', ['my.bin'])).toMatchObject({
			href: 'http://w/?ct=application%2Foctet-stream&cn=my.bin',
			text: 'my.bin'
		});
		expect(run('application_octetstream_download', 'x', ['', 'fname'])).toMatchObject({
			text: 'report.pdf'
		});
		expect(run('application_octetstream_download', 'x')).toMatchObject({ text: 'binary_file.dat' });
	});
});

describe('input plugins', () => {
	const input = (id: string) => INPUT_PLUGINS.find((p) => p.id === id)!;
	it('Iptolong', () => {
		const p = input('text_plain_iptolong');
		expect(p.apply('10.0.0.1', [], { isBinary: false }).value).toBe('167772161');
		expect(p.apply('hello', [], { isBinary: false }).value).toBe('hello');
		expect(p.toForm?.('167772161', { isBinary: false })).toBe('10.0.0.1');
	});
	it('Iptobinary', () => {
		const p = input('text_plain_iptobinary');
		expect(p.apply('127.0.0.1', [], { isBinary: false }).value).toBe('0x7f000001');
		expect(p.apply('127.0.0.1', [], { isBinary: true }).value).toBe('7f000001');
		expect(p.toForm?.('7f000001', { isBinary: true })).toBe('127.0.0.1');
		expect(p.toForm?.('zz', { isBinary: true })).toBe('');
	});
	it('RegexValidation', () => {
		const p = input('text_plain_regexvalidation');
		expect(p.apply('abc', ['/^a/'], { isBinary: false }).error).toBeUndefined();
		expect(p.apply('xbc', ['/^a/'], { isBinary: false }).error).toBe(
			'Validation failed for the input string xbc.'
		);
		expect(p.apply('ABC', ['/^a/i'], { isBinary: false }).error).toBeUndefined();
		expect(p.apply('x', ['#^x$#'], { isBinary: false }).error).toBeUndefined();
		expect(p.apply('x', [], { isBinary: false }).error).toBeUndefined();
		expect(phpRegex('abc')).toBeNull();
		expect(phpRegex('/(/')).toBeNull();
	});
});

describe('registry keys', () => {
	it('uses phpMyAdmin file names', () => {
		expect(outputKey(OUTPUT_PLUGINS.find((p) => p.id === 'text_plain_dateformat')!)).toBe(
			'output/text_plain_dateformat.php'
		);
		expect(outputKey(OUTPUT_PLUGINS.find((p) => p.id === 'text_plain_link')!)).toBe(
			'text_plain_link.php'
		);
		expect(inputKey(INPUT_PLUGINS.find((p) => p.id === 'text_plain_iptolong')!)).toBe(
			'input/text_plain_iptolong.php'
		);
	});
	it('resolves stored values leniently', () => {
		expect(resolveOutput('output/text_plain_dateformat.php')?.id).toBe('text_plain_dateformat');
		expect(resolveOutput('Output/Text_Plain_Dateformat.php')?.id).toBe('text_plain_dateformat');
		expect(resolveOutput('output/text_plain__dateformat.inc.php')?.id).toBe(
			'text_plain_dateformat'
		);
		expect(resolveOutput('text_plain_substring.php')?.id).toBe('text_plain_substring');
		expect(resolveOutput('output/nope.php')).toBeNull();
		expect(resolveOutput('')).toBeNull();
		expect(resolveInput('input/text_plain_iptolong.php')?.id).toBe('text_plain_iptolong');
		expect(normalizeKey('Input/Image_JPEG_Upload.php')).toBe('image_jpeg_upload');
	});
	it('lists media types', () => {
		expect(mimeTypes()).toEqual([
			'Image/JPEG',
			'Text/Plain',
			'Application/Octetstream',
			'Image/PNG',
			'Text/Octetstream'
		]);
		expect(mimeValue('Image/JPEG')).toBe('image_jpeg');
	});
});
