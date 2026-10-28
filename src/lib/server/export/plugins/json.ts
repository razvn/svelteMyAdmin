/**
 * JSON export, port of libraries/classes/Plugins/Export/ExportJson.php.
 *
 * The whole export is one JSON array. Elements are separated by `,` (PHP writes the comma after
 * the header and database elements and before tables, which yields invalid JSON when a database
 * has no tables; here every separator is placed by the writer, so the output is always valid).
 * Cells are encoded as PHP's json_encode would encode them: numbers and dates arrive as text
 * (so they are quoted, as in phpMyAdmin), NULL is `null`, binary values are `0x` + hex.
 */
import type {
	ExportCell,
	ExportContext,
	ExportOption,
	ExportPlugin,
	ExportScope
} from '../types.ts';
import { hexLiteral, optBool, resolveOptions, type ResolvedOptions } from './plugin-utils.ts';

const JSON_SCOPES: ExportScope[] = ['server', 'database', 'table', 'raw'];

export const JSON_OPTIONS: ExportOption[] = [
	{
		kind: 'bool',
		name: 'pretty_print',
		label: 'Output pretty-printed JSON (Use human-readable formatting)',
		default: false
	},
	{ kind: 'bool', name: 'unicode', label: 'Output unicode characters unescaped', default: true }
];

interface JsonEncoder {
	/** A JSON string literal (`json_encode` of a string). */
	str(value: string): string;
	/** A JSON object from already-encoded values, keeping insertion order. */
	object(pairs: [string, string][]): string;
}

/** `\uXXXX` escape (lower-case hex, like PHP) for one UTF-16 code unit. */
const escapeUnit = (char: string): string =>
	'\\u' + char.charCodeAt(0).toString(16).padStart(4, '0');

/** U+2028 and U+2029: PHP always escapes these, even with JSON_UNESCAPED_UNICODE. */
const LINE_SEPARATORS = new RegExp('[\\u2028\\u2029]', 'g');
/** Every non-ASCII code unit (used when JSON_UNESCAPED_UNICODE is off). */
const NON_ASCII = new RegExp('[\\u0080-\\uffff]', 'g');

/** `json_encode` with JSON_PRETTY_PRINT (4 spaces) and optionally JSON_UNESCAPED_UNICODE. */
export function makeJsonEncoder(pretty: boolean, unicode: boolean): JsonEncoder {
	const str = (value: string): string => {
		let out = JSON.stringify(value).replaceAll('/', '\\/');
		out = out.replace(LINE_SEPARATORS, escapeUnit);
		if (!unicode) out = out.replace(NON_ASCII, escapeUnit);
		return out;
	};
	const object = (pairs: [string, string][]): string => {
		if (pairs.length === 0) return '{}';
		if (!pretty) {
			return '{' + pairs.map(([key, value]) => `${str(key)}:${value}`).join(',') + '}';
		}
		return '{\n' + pairs.map(([key, value]) => `    ${str(key)}: ${value}`).join(',\n') + '\n}';
	};
	return { str, object };
}

interface JsonState {
	encoder: JsonEncoder;
	/** Whether a top-level element was written (a separator is needed before the next one). */
	started: boolean;
	/** Whether the last element ended with a newline (tables do, headers and databases do not). */
	afterNewline: boolean;
}

/** Per-export state, keyed by the context so concurrent exports do not share it. */
const states = new WeakMap<ExportContext, JsonState>();

function encoderFor(ctx: ExportContext): JsonEncoder {
	const o: ResolvedOptions = resolveOptions(JSON_OPTIONS, ctx.options);
	return makeJsonEncoder(optBool(o, 'pretty_print'), optBool(o, 'unicode'));
}

function stateOf(ctx: ExportContext): JsonState {
	let state = states.get(ctx);
	if (!state) {
		state = { encoder: encoderFor(ctx), started: false, afterNewline: false };
		states.set(ctx, state);
	}
	return state;
}

async function beginElement(ctx: ExportContext, state: JsonState): Promise<void> {
	if (state.started) {
		await ctx.write(state.afterNewline ? ',' : ',' + ctx.crlf);
	}
	state.started = true;
	state.afterNewline = false;
}

function cellJson(encoder: JsonEncoder, cell: ExportCell): string {
	if (cell === null) return 'null';
	if (typeof cell === 'string') return encoder.str(cell);
	return encoder.str(hexLiteral(cell));
}

const json: ExportPlugin = {
	id: 'json',
	label: 'JSON',
	extension: 'json',
	mimeType: 'text/plain',
	scopes: JSON_SCOPES,
	supports: { structure: false, data: true },
	options: JSON_OPTIONS,

	async header(ctx) {
		const state: JsonState = { encoder: encoderFor(ctx), started: false, afterNewline: false };
		states.set(ctx, state);
		await ctx.write('[' + ctx.crlf);
		await beginElement(ctx, state);
		await ctx.write(
			state.encoder.object([
				['type', '"header"'],
				['version', state.encoder.str(ctx.appVersion)],
				['comment', state.encoder.str('Export to JSON plugin for svelteMyAdmin')]
			])
		);
	},

	async footer(ctx) {
		const state = stateOf(ctx);
		await ctx.write((state.afterNewline ? '' : ctx.crlf) + ']' + ctx.crlf);
	},

	async dbHeader(ctx, db, alias) {
		const state = stateOf(ctx);
		await beginElement(ctx, state);
		await ctx.write(
			state.encoder.object([
				['type', '"database"'],
				['name', state.encoder.str(alias || db)]
			])
		);
	},

	async data(ctx, data) {
		const state = stateOf(ctx);
		const { encoder } = state;
		const pairs: [string, string][] =
			ctx.scope === 'raw'
				? [
						['type', '"raw"'],
						['data', '"@@DATA@@"']
					]
				: [
						['type', '"table"'],
						['name', encoder.str(data.ref.alias || data.ref.table)],
						['database', encoder.str(data.ref.db)],
						['data', '"@@DATA@@"']
					];
		// Same split as PHP: encode the element with a placeholder, then write around it.
		const [head, tail] = encoder.object(pairs).split('"@@DATA@@"');
		await beginElement(ctx, state);
		await ctx.write(head + ctx.crlf + '[' + ctx.crlf);
		let count = 0;
		for await (const row of data.rows) {
			if (count > 0) await ctx.write(',' + ctx.crlf);
			const record = new Map<string, string>();
			data.fields.forEach((field, i) => {
				record.set(field.name, cellJson(encoder, row[i] ?? null));
			});
			await ctx.write(encoder.object([...record]));
			count++;
		}
		await ctx.write(ctx.crlf + ']' + ctx.crlf + tail + ctx.crlf);
		state.afterNewline = true;
	}
};

export default json;
