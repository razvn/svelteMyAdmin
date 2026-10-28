/**
 * OpenDocument Spreadsheet export, mirroring libraries/classes/Plugins/Export/ExportOds.php.
 * One sheet per exported table; the whole package is built in memory and written once in `footer`.
 */
import type {
	ExportContext,
	ExportData,
	ExportField,
	ExportPlugin
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

export const ODS_MIME = 'application/vnd.oasis.opendocument.spreadsheet';

const HEADER =
	'<?xml version="1.0" encoding="utf-8"?>' +
	`<office:document-content ${NS} office:version="1.0">` +
	'<office:automatic-styles>' +
	'<number:date-style style:name="N37" number:automatic-order="true">' +
	'<number:month number:style="long"/><number:text>/</number:text>' +
	'<number:day number:style="long"/><number:text>/</number:text><number:year/>' +
	'</number:date-style>' +
	'<number:time-style style:name="N43">' +
	'<number:hours number:style="long"/><number:text>:</number:text>' +
	'<number:minutes number:style="long"/><number:text>:</number:text>' +
	'<number:seconds number:style="long"/><number:text> </number:text><number:am-pm/>' +
	'</number:time-style>' +
	'<number:date-style style:name="N50" number:automatic-order="true" number:format-source="language">' +
	'<number:month/><number:text>/</number:text><number:day/><number:text>/</number:text><number:year/>' +
	'<number:text> </number:text><number:hours number:style="long"/><number:text>:</number:text>' +
	'<number:minutes number:style="long"/><number:text> </number:text><number:am-pm/>' +
	'</number:date-style>' +
	'<style:style style:name="DateCell" style:family="table-cell" style:parent-style-name="Default" style:data-style-name="N37"/>' +
	'<style:style style:name="TimeCell" style:family="table-cell" style:parent-style-name="Default" style:data-style-name="N43"/>' +
	'<style:style style:name="DateTimeCell" style:family="table-cell" style:parent-style-name="Default" style:data-style-name="N50"/>' +
	'</office:automatic-styles><office:body><office:spreadsheet>';

const FOOTER = '</office:spreadsheet></office:body></office:document-content>';

interface State {
	buffer: string;
	names: Set<string>;
}
const states = new WeakMap<ExportContext, State>();

function state(ctx: ExportContext): State {
	let s = states.get(ctx);
	if (!s) {
		s = { buffer: HEADER, names: new Set() };
		states.set(ctx, s);
	}
	return s;
}

/** `YYYY-MM-DD[ T]HH:MM:SS[.fff]` parts, or null (zero dates, garbage). */
function parseDateTime(v: string) {
	const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}):(\d{2}))?/.exec(v);
	if (!m || m[1] === '0000' || m[2] === '00' || m[3] === '00') return null;
	return {
		date: `${m[1]}-${m[2]}-${m[3]}`,
		time: m[4] ? `${m[4].padStart(2, '0')}:${m[5]}:${m[6]}` : '00:00:00'
	};
}

/** MySQL TIME (`-12:34:56`, `838:59:59`, optional fraction) as ISO 8601 duration. */
function parseTime(v: string): string | null {
	const m = /^(-?)(\d+):(\d{2}):(\d{2})/.exec(v);
	return m ? `${m[1]}PT${m[2].padStart(2, '0')}H${m[3]}M${m[4]}S` : null;
}

function typedCell(field: ExportField, value: string): string {
	const text = escapeXml(value);
	if (field.type === 'date') {
		const d = parseDateTime(value);
		if (d) {
			return `<table:table-cell office:value-type="date" office:date-value="${d.date}" table:style-name="DateCell"><text:p>${text}</text:p></table:table-cell>`;
		}
	} else if (field.type === 'time') {
		const t = parseTime(value);
		if (t) {
			return `<table:table-cell office:value-type="time" office:time-value="${t}" table:style-name="TimeCell"><text:p>${text}</text:p></table:table-cell>`;
		}
	} else if (field.type === 'datetime' || field.type === 'timestamp') {
		const d = parseDateTime(value);
		if (d) {
			return `<table:table-cell office:value-type="date" office:date-value="${d.date}T${d.time}" table:style-name="DateTimeCell"><text:p>${text}</text:p></table:table-cell>`;
		}
	} else if (field.isNumeric && value.trim() !== '' && Number.isFinite(Number(value))) {
		return floatCell(value);
	}
	return stringCell(value);
}

const ods: ExportPlugin = {
	id: 'ods',
	label: 'OpenDocument Spreadsheet',
	extension: 'ods',
	mimeType: ODS_MIME,
	scopes: ['server', 'database', 'table', 'raw'],
	supports: { structure: false, data: true },
	binary: true,
	options: [
		{
			kind: 'text',
			name: 'null',
			label: 'Replace NULL with:',
			default: 'NULL',
			group: 'general_opts'
		},
		{
			kind: 'bool',
			name: 'columns',
			label: 'Put columns names in the first row',
			default: false,
			group: 'general_opts'
		}
	],

	async header(ctx) {
		states.set(ctx, { buffer: HEADER, names: new Set() });
	},

	async data(ctx, data: ExportData) {
		const s = state(ctx);
		const nullText = String(ctx.options.null ?? 'NULL');
		let name = data.ref.alias || data.ref.table || 'Sheet';
		for (let i = 2; s.names.has(name); i++)
			name = `${data.ref.alias || data.ref.table || 'Sheet'}_${i}`;
		s.names.add(name);

		let out = `<table:table table:name="${escapeXml(name)}">`;
		if (ctx.options.columns) {
			out += '<table:table-row>';
			for (const f of data.fields) out += stringCell(f.name);
			out += '</table:table-row>';
		}
		for await (const row of data.rows) {
			out += '<table:table-row>';
			data.fields.forEach((field, j) => {
				const cell = row[j] ?? null;
				if (cell === null) out += stringCell(nullText);
				else if (isBlobField(field)) out += stringCell('');
				else if (Buffer.isBuffer(cell)) out += stringCell(cellText(field, cell, nullText));
				else out += typedCell(field, cell);
			});
			out += '</table:table-row>';
		}
		out += '</table:table>';
		s.buffer += out;
	},

	async footer(ctx) {
		const s = state(ctx);
		states.delete(ctx);
		await ctx.write(createOpenDocument(ODS_MIME, s.buffer + FOOTER, ctx.appVersion, ctx.now));
	}
};

export default ods;
