/**
 * Input transformations of the insert/edit form, ported from
 * libraries/classes/Plugins/Transformations/{Input/*,Abs/*}.
 */
import { inetNtop, ipToBinary, ipToLong, longToIp } from './convert.ts';
import type { InputPlugin } from './types.ts';

/**
 * Compile a PHP preg pattern (`/regex/flags`). Returns null when the delimiters are malformed
 * or the expression is not valid in JavaScript.
 */
export function phpRegex(pattern: string): RegExp | null {
	const delim = pattern[0];
	if (!delim || /[\w\s\\]/.test(delim)) return null;
	const closing =
		({ '(': ')', '[': ']', '{': '}', '<': '>' } as Record<string, string>)[delim] ?? delim;
	const end = pattern.lastIndexOf(closing);
	if (end <= 0) return null;
	const body = pattern.slice(1, end);
	let flags = '';
	for (const f of pattern.slice(end + 1)) {
		if ('ims'.includes(f) && !flags.includes(f)) flags += f;
		else if (f === 'u') flags += flags.includes('u') ? '' : 'u';
		else if (f === 'D' || f === 'U' || f === 'x' || f === 'A' || f === 'S' || f === 'X') continue;
		else return null;
	}
	try {
		return new RegExp(body, flags);
	} catch {
		return null;
	}
}

const EDITOR_DESCRIPTION = (name: string) => `Syntax highlighted CodeMirror editor for ${name}.`;

function editor(
	id: string,
	name: string,
	title: string,
	language: 'json' | 'sql' | 'xml'
): InputPlugin {
	return {
		id,
		mime: 'Text/Plain',
		name,
		title,
		description: EDITOR_DESCRIPTION(title),
		widget: 'editor',
		language,
		apply: (value) => ({ value })
	};
}

export const INPUT_PLUGINS: InputPlugin[] = [
	{
		id: 'image_jpeg_upload',
		mime: 'Image/JPEG',
		name: 'Upload',
		title: 'Image upload',
		description:
			'Image upload functionality which also displays a thumbnail. The options are the width and height of the thumbnail in pixels. Defaults to 100 X 100.',
		widget: 'image',
		apply: (value) => ({ value })
	},
	{
		id: 'text_plain_fileupload',
		mime: 'Text/Plain',
		name: 'FileUpload',
		title: 'Text file upload',
		description:
			'File upload functionality for TEXT columns. It does not have a textarea for input.',
		widget: 'file',
		apply: (value) => ({ value })
	},
	{
		id: 'text_plain_iptobinary',
		mime: 'Text/Plain',
		name: 'Iptobinary',
		title: 'IPv4/IPv6 To Binary',
		description: 'Converts an Internet network address in (IPv4/IPv6) format to binary',
		widget: 'text',
		// stored binary values are kept as hex in the form: show the address they encode
		toForm(stored, { isBinary }) {
			if (!isBinary) return stored;
			const hex = stored.replace(/^0x/i, '');
			if (!/^([0-9a-f]{2})*$/i.test(hex) || (hex.length !== 8 && hex.length !== 32)) return '';
			return inetNtop(Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16))) ?? '';
		},
		apply(value, _o, { isBinary }) {
			const converted = ipToBinary(value);
			return { value: isBinary ? converted.replace(/^0x/, '') : converted };
		}
	},
	{
		id: 'text_plain_iptolong',
		mime: 'Text/Plain',
		name: 'Iptolong',
		title: 'IPv4/IPv6 To Long',
		description: 'Converts an Internet network address in (IPv4/IPv6) format into a long integer.',
		widget: 'text',
		toForm: (stored) => (stored === '' ? '' : longToIp(stored)),
		apply: (value) => ({ value: ipToLong(value) })
	},
	editor('text_plain_jsoneditor', 'JsonEditor', 'JSON', 'json'),
	{
		id: 'text_plain_regexvalidation',
		mime: 'Text/Plain',
		name: 'RegexValidation',
		title: 'Regex Validation',
		description:
			'Validates the string using regular expression and performs insert only if string matches it. The first option is the Regular Expression.',
		widget: 'default',
		apply(value, options) {
			const pattern = options[0];
			if (pattern) {
				const re = phpRegex(pattern);
				if (!re || !re.test(value)) {
					return { value, error: `Validation failed for the input string ${value}.` };
				}
			}
			return { value };
		}
	},
	editor('text_plain_sqleditor', 'SqlEditor', 'SQL', 'sql'),
	editor('text_plain_xmleditor', 'XmlEditor', 'XML', 'xml')
];
