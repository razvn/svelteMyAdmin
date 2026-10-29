/**
 * YAML export, port of libraries/classes/Plugins/Export/ExportYaml.php.
 * One YAML document; each table is a list of mappings with a `# db.table` comment.
 */
import { N_ } from '#lib/i18n/translator.ts';
import type { ExportCell, ExportField, ExportPlugin, ExportScope } from '../types.ts';
import { emit, isPhpNumeric, type Piece, replaceAll } from './plugin-utils.ts';

const YAML_SCOPES: ExportScope[] = ['server', 'database', 'table', 'raw'];

/** Column types PHP's FieldMetadata maps to TYPE_STRING (MYSQLI_TYPE_STRING / VAR_STRING). */
const STRING_TYPES = new Set(['char', 'varchar', 'binary', 'varbinary', 'enum', 'set']);

/** One `  name: value` line. Numbers of non-string columns stay unquoted, others are quoted. */
export function yamlLine(field: ExportField, cell: ExportCell, crlf: string): Piece[] {
	const prefix = `  ${field.name}: `;
	if (cell === null) return [prefix + 'null' + crlf];
	if (typeof cell === 'string' && !STRING_TYPES.has(field.type) && isPhpNumeric(cell)) {
		return [prefix + cell + crlf];
	}
	let value: Piece = replaceAll(cell, '\\', '\\\\');
	value = replaceAll(value, '"', '\\"');
	value = replaceAll(value, '\n', '\\n');
	value = replaceAll(value, '\r', '\\r');
	return [prefix + '"', value, '"' + crlf];
}

const yaml: ExportPlugin = {
	id: 'yaml',
	label: N_('YAML'),
	extension: 'yml',
	mimeType: 'text/yaml',
	scopes: YAML_SCOPES,
	supports: { structure: false, data: true },
	options: [],

	async header(ctx) {
		await ctx.write('%YAML 1.1' + ctx.crlf + '---' + ctx.crlf);
	},

	async footer(ctx) {
		await ctx.write('...' + ctx.crlf);
	},

	async data(ctx, data) {
		const crlf = ctx.crlf;
		const alias = data.ref.alias || data.ref.table;
		let count = 0;
		for await (const row of data.rows) {
			const pieces: Piece[] =
				count === 0 ? [`# ${data.ref.db}.${alias}${crlf}-${crlf}`] : ['-' + crlf];
			data.fields.forEach((field, i) => {
				pieces.push(...yamlLine(field, row[i] ?? null, crlf));
			});
			await emit(ctx, pieces);
			count++;
		}
	}
};

export default yaml;
