/**
 * Output (browser display) transformations, ported from
 * libraries/classes/Plugins/Transformations/{Output/*,Abs/*,Text_Plain_*.php}.
 * Plugin ids follow phpMyAdmin's file names so the value stored in `pma__column_info` is shared.
 */
import { formatBinary } from '#lib/components/results/format.ts';
import { binaryToIp, longToIp, toHex } from './convert.ts';
import { gmdate, strftime, toTimestamp } from './format-date.ts';
import { intval, withDefaults } from './options.ts';
import type { OutputPlugin, TransformInput, Transformed } from './types.ts';

const text = (t: string, title?: string): Transformed => ({ type: 'text', text: t, title });

/** Array.from-based mb_substr (negative start / length count from the end). */
export function mbSubstr(s: string, start: number, length?: number): string {
	const chars = Array.from(s);
	let from = start < 0 ? Math.max(chars.length + start, 0) : start;
	if (from > chars.length) from = chars.length;
	let to = chars.length;
	if (length !== undefined) to = length < 0 ? chars.length + length : from + length;
	return to <= from ? '' : chars.slice(from, to).join('');
}

/** Sanitize::checkLink($url, true, true): the URL schemes a transformation may link to. */
export function isSafeLink(url: string): boolean {
	const u = url.toLowerCase();
	return ['https://', 'http://', 'ftp://', 'mailto:', './index.php?', './doc/html/'].some((p) =>
		u.startsWith(p)
	);
}

/** PHP's loose `$buffer == '0'`. */
function isZero(s: string): boolean {
	return /^\s*[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*$/i.test(s) && Number(s) === 0;
}

/** Pretty printer for XML text (indentation only; text is left alone when it is not tag soup). */
export function prettyXml(xml: string): string {
	const tokens = xml.replace(/>\s*</g, '><').match(/<[^>]+>|[^<]+/g);
	if (!tokens) return xml;
	const out: string[] = [];
	let depth = 0;
	for (let i = 0; i < tokens.length; i++) {
		const t = tokens[i];
		if (t.startsWith('</')) {
			depth = Math.max(0, depth - 1);
			out.push('  '.repeat(depth) + t);
		} else if (
			t.startsWith('<') &&
			!t.startsWith('<?') &&
			!t.startsWith('<!') &&
			!t.endsWith('/>')
		) {
			// <a>text</a> stays on one line
			if (tokens[i + 1] && !tokens[i + 1].startsWith('<') && tokens[i + 2]?.startsWith('</')) {
				out.push('  '.repeat(depth) + t + tokens[i + 1] + tokens[i + 2]);
				i += 2;
			} else {
				out.push('  '.repeat(depth) + t);
				depth++;
			}
		} else {
			out.push('  '.repeat(depth) + t);
		}
	}
	return out.join('\n');
}

function prettyJsonText(s: string): string {
	try {
		return JSON.stringify(JSON.parse(s), null, 2);
	} catch {
		return s;
	}
}

const wrapperOrNull = (
	ctx: Parameters<OutputPlugin['apply']>[2],
	extra?: Record<string, string>
): string | null => ctx.wrapper(extra);

function bytesAlt(input: TransformInput): string {
	return input.bytes ? formatBinary({ bytes: input.bytes.length, preview: '' }) : input.text;
}

function inline(id: string, mime: string, name: string): OutputPlugin {
	return {
		id,
		mime,
		name,
		dir: 'output',
		title: 'Inline',
		description:
			'Displays a clickable thumbnail. The options are the maximum width and height in pixels. The original aspect ratio is preserved.',
		apply(input, options, ctx) {
			const o = withDefaults(options, ['100', 100]);
			const src = wrapperOrNull(ctx);
			if (!src) return text(bytesAlt(input));
			return {
				type: 'image',
				src,
				href: src,
				alt: `[${bytesAlt(input)}]`,
				width: intval(o[0]) || undefined,
				height: intval(o[1]) || undefined
			};
		}
	};
}

function imageLink(id: string, mime: string, name: string): OutputPlugin {
	return {
		id,
		mime,
		name,
		dir: 'output',
		title: 'ImageLink',
		description: 'Displays a link to download this image.',
		apply(input, _options, ctx) {
			const href = wrapperOrNull(ctx);
			if (!href) return text(bytesAlt(input));
			return { type: 'link', href, text: '[BLOB]', title: `[${bytesAlt(input)}]`, blank: true };
		}
	};
}

const SQL_DESCRIPTION = 'Formats text as SQL query with syntax highlighting.';

function sql(id: string, mime: string): OutputPlugin {
	return {
		id,
		mime,
		name: 'Sql',
		dir: 'output',
		title: 'SQL',
		description: SQL_DESCRIPTION,
		apply: (input) => ({ type: 'code', language: 'sql', text: input.text })
	};
}

const HEX_DESCRIPTION =
	'Displays hexadecimal representation of data. Optional first parameter specifies how often space will be added (defaults to 2 nibbles).';

export const OUTPUT_PLUGINS: OutputPlugin[] = [
	{
		id: 'application_octetstream_download',
		mime: 'Application/Octetstream',
		name: 'Download',
		dir: 'output',
		title: 'Download',
		description:
			'Displays a link to download the binary data of the column. You can use the first option to specify the filename, or use the second option as the name of a column which contains the filename. If you use the second option, you need to set the first option to the empty string.',
		apply(_input, options, ctx) {
			let name = options[0];
			if (!name && options[1]) name = ctx.rowValue(options[1]) ?? '';
			if (!name) name = 'binary_file.dat';
			const href = wrapperOrNull(ctx, { ct: 'application/octet-stream', cn: name });
			return href ? { type: 'link', href, text: name, title: name } : text(name);
		}
	},
	{
		id: 'application_octetstream_hex',
		mime: 'Application/Octetstream',
		name: 'Hex',
		dir: 'output',
		title: 'Hex',
		description: HEX_DESCRIPTION,
		apply(input, options) {
			const n = intval(withDefaults(options, ['2'])[0]);
			const bytes = input.bytes ?? new TextEncoder().encode(input.text);
			const hex = toHex(bytes);
			return text(n < 1 ? hex : (hex.match(new RegExp(`.{1,${n}}`, 'g')) ?? []).join(' ') + ' ');
		}
	},
	inline('image_jpeg_inline', 'Image/JPEG', 'Inline'),
	imageLink('image_jpeg_link', 'Image/JPEG', 'Link'),
	inline('image_png_inline', 'Image/PNG', 'Inline'),
	sql('text_octetstream_sql', 'Text/Octetstream'),
	{
		id: 'text_plain_binarytoip',
		mime: 'Text/Plain',
		name: 'Binarytoip',
		dir: 'output',
		title: 'Binary To IPv4/IPv6',
		description:
			'Converts an Internet network address stored as a binary string into a string in Internet standard (IPv4/IPv6) format.',
		apply: (input, _options, ctx) => text(binaryToIp(input.text, ctx.column.isBinary, input.bytes))
	},
	{
		id: 'text_plain_bool2text',
		mime: 'Text/Plain',
		name: 'Bool2Text',
		dir: 'output',
		title: 'Bool2Text',
		description:
			"Converts Boolean values to text (default 'T' and 'F'). First option is for TRUE, second for FALSE. Nonzero=true.",
		apply(input, options) {
			const o = withDefaults(options, ['T', 'F']);
			return text(isZero(input.text) ? (o[1] ?? '') : (o[0] ?? ''));
		}
	},
	{
		id: 'text_plain_dateformat',
		mime: 'Text/Plain',
		name: 'Dateformat',
		dir: 'output',
		title: 'Date Format',
		description:
			'Displays a TIME, TIMESTAMP, DATETIME or numeric unix timestamp column as formatted date. The first option is the offset (in hours) which will be added to the timestamp (Default: 0). Use second option to specify a different date/time format string. Third option determines whether you want to see local date or UTC one (use "local" or "utc" strings) for that. According to that, date format has different value - for "local" see the documentation for PHP\'s strftime() function and for "utc" it is done using gmdate() function.',
		apply(input, options, ctx) {
			const o = withDefaults(options, [0, '', 'local']);
			const type = (o[2] ?? '').toLowerCase();
			let format = o[1] ?? '';
			if (format === '' || format === '0') {
				format = type === 'local' ? '%B %d, %Y at %I:%M %p' : 'Y-m-d  H:i:s';
			}
			const source = input.text;
			let ts = toTimestamp(source, ctx.column.isInt);
			if (ts < 0) return text(source);
			ts -= intval(o[0]) * 3600;
			if (type === 'local') return text(strftime(ts, format), source);
			if (type === 'utc') return text(gmdate(format, ts), source);
			return text('INVALID DATE TYPE', source);
		}
	},
	{
		id: 'text_plain_external',
		mime: 'Text/Plain',
		name: 'External',
		dir: 'output',
		title: 'External',
		description:
			'Launches an external application. Not supported in svelteMyAdmin for security reasons: the value is shown as stored.',
		unsupported: true,
		apply: (input) => text(input.text, 'The External transformation is not supported')
	},
	{
		id: 'text_plain_formatted',
		mime: 'Text/Plain',
		name: 'Formatted',
		dir: 'output',
		title: 'Formatted',
		description:
			'Displays the contents of the column as-is, without running it through htmlspecialchars(). That is, the column is assumed to contain valid HTML (shown in a sandboxed frame).',
		apply: (input) => ({ type: 'frame', srcdoc: input.text.replaceAll('"', "'") })
	},
	{
		id: 'text_plain_imagelink',
		mime: 'Text/Plain',
		name: 'Imagelink',
		dir: 'output',
		title: 'Image Link',
		description:
			'Displays an image and a link; the column contains the filename. The first option is a URL prefix like "https://www.example.com/". The second and third options are the width and the height in pixels.',
		apply(input, options) {
			const o = withDefaults(options, [null, 100, 50]);
			const url = (o[0] ?? '') + input.text;
			if (!isSafeLink(url)) return text(url);
			return {
				type: 'image',
				src: url,
				href: url,
				alt: input.text,
				width: intval(o[1]) || undefined,
				height: intval(o[2]) || undefined
			};
		}
	},
	{
		id: 'text_plain_json',
		mime: 'Text/Plain',
		name: 'Json',
		dir: 'output',
		title: 'JSON',
		description: 'Formats text as JSON with syntax highlighting.',
		apply: (input) => ({ type: 'code', language: 'json', text: prettyJsonText(input.text) })
	},
	sql('text_plain_sql', 'Text/Plain'),
	{
		id: 'text_plain_xml',
		mime: 'Text/Plain',
		name: 'Xml',
		dir: 'output',
		title: 'XML',
		description: 'Formats text as XML with syntax highlighting.',
		apply: (input) => ({ type: 'code', language: 'xml', text: prettyXml(input.text) })
	},
	// ---- root directory (usable as output; phpMyAdmin lists them for input too) ----
	{
		id: 'text_plain_link',
		mime: 'Text/Plain',
		name: 'Link',
		dir: '',
		title: 'TextLink',
		description:
			'Displays a link; the column contains the filename. The first option is a URL prefix like "https://www.example.com/". The second option is a title for the link.',
		apply(input, options) {
			const o = withDefaults(options, [null, null, null]);
			const url = (o[0] ?? '') + (o[2] ? '' : input.text);
			if (!isSafeLink(url)) return text(url);
			return { type: 'link', href: url, text: o[1] ?? input.text, title: o[1] ?? '', blank: true };
		}
	},
	{
		id: 'text_plain_longtoipv4',
		mime: 'Text/Plain',
		name: 'Longtoipv4',
		dir: '',
		title: 'Long To IPv4',
		description:
			'Converts an (IPv4) Internet network address stored as a BIGINT into a string in Internet standard dotted format.',
		apply: (input) => text(longToIp(input.text))
	},
	{
		id: 'text_plain_preappend',
		mime: 'Text/Plain',
		name: 'PreApPend',
		dir: '',
		title: 'PreApPend',
		description:
			'Prepends and/or Appends text to a string. First option is text to be prepended, second is appended (enclosed in single quotes, default empty string).',
		apply(input, options) {
			const o = withDefaults(options, ['', '']);
			return text((o[0] ?? '') + input.text + (o[1] ?? ''));
		}
	},
	{
		id: 'text_plain_substring',
		mime: 'Text/Plain',
		name: 'Substring',
		dir: '',
		title: 'Substring',
		description:
			'Displays a part of a string. The first option is the number of characters to skip from the beginning of the string (Default 0). The second option is the number of characters to return (Default: until end of string). The third option is the string to append and/or prepend when truncation occurs (Default: "…").',
		apply(input, options) {
			const o = withDefaults(options, [0, 'all', '…']);
			const skip = intval(o[0]);
			const marker = o[2] ?? '';
			let out =
				o[1] !== 'all' ? mbSubstr(input.text, skip, intval(o[1])) : mbSubstr(input.text, skip);
			const length = Array.from(out).length;
			const base = Array.from(input.text).length;
			if (length !== base) {
				if (skip !== 0) out = marker + out;
				if (length + skip !== base) out += marker;
			}
			return text(out);
		}
	}
];
