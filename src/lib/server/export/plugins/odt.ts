/**
 * OpenDocument Text export, mirroring libraries/classes/Plugins/Export/ExportOdt.php.
 * Not offered: the "media types" column (needs the pmadb browser-transformation feature, which
 * phpMyAdmin hides without it too).
 */
import { N_ } from '#lib/i18n/translator.ts';
import type {
	ExportContext,
	ExportData,
	ExportPlugin,
	ExportTableRef
} from '#lib/server/export/types.ts';
import {
	NS,
	cellText,
	createOpenDocument,
	escapeXml,
	floatCell,
	isBlobField,
	stringCell
} from '#lib/server/export/plugins/opendocument.ts';
import { loadStructure } from '#lib/server/export/plugins/table-structure.ts';

export const ODT_MIME = 'application/vnd.oasis.opendocument.text';

const HEADER =
	'<?xml version="1.0" encoding="utf-8"?>' +
	`<office:document-content ${NS} office:version="1.0">` +
	'<office:body><office:text>';
const FOOTER = '</office:text></office:body></office:document-content>';

const buffers = new WeakMap<ExportContext, string>();

function append(ctx: ExportContext, xml: string): void {
	buffers.set(ctx, (buffers.get(ctx) ?? HEADER) + xml);
}

function heading(level: 1 | 2, text: string): string {
	return `<text:h text:outline-level="${level}" text:style-name="Heading_${level}" text:is-list-header="true">${escapeXml(text)}</text:h>`;
}

function row(cells: string[]): string {
	return `<table:table-row>${cells.map(stringCell).join('')}</table:table-row>`;
}

const odt: ExportPlugin = {
	id: 'odt',
	label: N_('OpenDocument Text'),
	extension: 'odt',
	mimeType: ODT_MIME,
	scopes: ['server', 'database', 'table', 'raw'],
	supports: { structure: true, data: true },
	binary: true,
	options: [
		{
			kind: 'radio',
			name: 'structure_or_data',
			label: N_('Dump table'),
			default: 'structure_and_data',
			choices: [
				{ value: 'structure', label: N_('structure') },
				{ value: 'data', label: N_('data') },
				{ value: 'structure_and_data', label: N_('structure and data') }
			],
			group: 'general_opts'
		},
		{
			kind: 'bool',
			name: 'relation',
			label: N_('Display foreign key relationships'),
			default: true,
			group: 'structure'
		},
		{
			kind: 'bool',
			name: 'comments',
			label: N_('Display comments'),
			default: true,
			group: 'structure'
		},
		{
			kind: 'bool',
			name: 'columns',
			label: N_('Put columns names in the first row'),
			default: true,
			group: 'data'
		},
		{ kind: 'text', name: 'null', label: N_('Replace NULL with:'), default: 'NULL', group: 'data' }
	],

	async header(ctx) {
		buffers.set(ctx, HEADER);
	},

	async footer(ctx) {
		const xml = (buffers.get(ctx) ?? HEADER) + FOOTER;
		buffers.delete(ctx);
		await ctx.write(createOpenDocument(ODT_MIME, xml, ctx.appVersion, ctx.now));
	},

	async dbHeader(ctx, db, alias) {
		append(ctx, heading(1, `Database ${alias || db}`));
	},

	async structure(ctx, ref: ExportTableRef) {
		const name = ref.alias || ref.table;
		const info = await loadStructure(ctx.conn, ref.db, ref.table);
		const relation = ctx.options.relation !== false && info.foreigners.size > 0;
		const comments = ctx.options.comments !== false;
		const title = ref.kind === 'view' ? 'Structure for view' : 'Table structure for table';

		const head = ['Column', 'Type', 'Null', 'Default'];
		if (relation) head.push('Links to');
		if (comments) head.push('Comments');

		let out = heading(2, `${title} ${name}`);
		out += `<table:table table:name="${escapeXml(name)}_structure">`;
		out += `<table:table-column table:number-columns-repeated="${head.length}"/>`;
		out += row(head);
		for (const c of info.columns) {
			const cells = [c.name, c.type || ' ', c.nullable ? 'Yes' : 'No', c.default];
			if (relation) {
				const fk = info.foreigners.get(c.name);
				cells.push(fk ? `${fk.table} (${fk.field})` : '');
			}
			if (comments) cells.push(c.comment);
			out += row(cells);
		}
		out += '</table:table>';
		append(ctx, out);
	},

	async data(ctx, data: ExportData) {
		const name = data.ref.alias || data.ref.table;
		const nullText = String(ctx.options.null ?? 'NULL');
		let out = heading(2, name ? `Dumping data for table ${name}` : 'Dumping data for query result');
		out += `<table:table table:name="${escapeXml(name)}_data">`;
		out += `<table:table-column table:number-columns-repeated="${data.fields.length}"/>`;
		if (ctx.options.columns !== false) out += row(data.fields.map((f) => f.name));
		for await (const r of data.rows) {
			out += '<table:table-row>';
			data.fields.forEach((field, j) => {
				const cell = r[j] ?? null;
				if (cell === null || isBlobField(field) || Buffer.isBuffer(cell)) {
					out += stringCell(cellText(field, cell, nullText));
				} else if (field.isNumeric && cell.trim() !== '' && Number.isFinite(Number(cell))) {
					out += floatCell(cell);
				} else {
					out += stringCell(cell);
				}
			});
			out += '</table:table-row>';
		}
		out += '</table:table>';
		append(ctx, out);
	}
};

export default odt;
