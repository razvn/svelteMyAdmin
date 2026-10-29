/**
 * PDF export, mirroring libraries/classes/Plugins/Export/ExportPdf.php and Helpers/Pdf.php
 * (A3 landscape, report title, "Database/Table/Purpose" line, grey header row repeated on every
 * page, column widths fitted to the content). Rendered with pdfkit and an embedded DejaVu Sans so
 * Latin Extended / Cyrillic / Greek text renders; all pages are built in memory in `footer`.
 */
import { N_ } from '#lib/i18n/translator.ts';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import type {
	ExportContext,
	ExportData,
	ExportField,
	ExportPlugin,
	ExportTableRef
} from '#lib/server/export/types.ts';
import { isBlobField } from '#lib/server/export/plugins/opendocument.ts';
import { loadStructure } from '#lib/server/export/plugins/table-structure.ts';

/** A3 landscape in points (TCPDF `new Pdf('L', 'pt', 'A3')`). */
const PAGE: [number, number] = [1190.55, 841.89];
const MARGIN_X = 30;
const TABLE_TOP = 76;
const BOTTOM = 48;
const FONT_SIZE = 9;
const TITLE_SIZE = 18;
const PAD_X = 3;
const PAD_Y = 2;
const MAX_TEXT = 4000;

const INT_TYPES = new Set(['tinyint', 'smallint', 'mediumint', 'int', 'integer', 'bigint']);

interface Section {
	db: string;
	table: string;
	purpose: string;
	titles: string[];
	/** Fixed widths (structure tables) or undefined to fit to the content. */
	widths?: number[];
	aligns: ('left' | 'right')[];
	rows: string[][];
}

const sections = new WeakMap<ExportContext, Section[]>();

function list(ctx: ExportContext): Section[] {
	let s = sections.get(ctx);
	if (!s) {
		s = [];
		sections.set(ctx, s);
	}
	return s;
}

let fontData: Buffer | undefined;
function loadFont(): Buffer {
	fontData ??= readFileSync(
		createRequire(import.meta.url).resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf')
	);
	return fontData;
}

function clean(text: string): string {
	// eslint-disable-next-line no-control-regex
	let t = text.replace(/\t/g, ' ').replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '');
	if (t.length > MAX_TEXT) t = t.slice(0, MAX_TEXT) + '…';
	return t;
}

function cellString(field: ExportField, cell: Buffer | string | null): string {
	if (cell === null) return 'NULL';
	if (Buffer.isBuffer(cell)) return '0x' + cell.toString('hex');
	return clean(cell);
}

/** Port of Pdf::mysqlReport pass 1: widths fitted to titles/content within the page width. */
function fitWidths(
	doc: PDFKit.PDFDocument,
	titles: string[],
	rows: string[][],
	available: number
): number[] {
	const n = titles.length;
	const sCol = available / n;
	const w = (t: string) => doc.widthOfString(t) + 6;
	const titleWidth = titles.map(w);
	const total = titleWidth.reduce((a, b) => a + b, 0);
	const colFits = new Map<number, number>();
	titleWidth.forEach((tw, i) => {
		if (tw < sCol) colFits.set(i, tw);
	});
	const adjusting = total > available;
	if (!adjusting) titleWidth.forEach((tw, i) => colFits.set(i, tw));
	for (const row of rows) {
		for (const [key, val] of [...colFits]) {
			const sw = w(row[key] ?? 'NULL');
			if (adjusting && sw > sCol) colFits.delete(key);
			else if (sw > val && sw < sCol * 3) colFits.set(key, sw);
		}
	}
	let fitted = 0;
	for (const v of colFits.values()) fitted += v;
	const free = n - colFits.size;
	const surplus = adjusting && free > 0 ? (colFits.size * sCol - fitted) / free : 0;
	return titles.map((_, i) => colFits.get(i) ?? sCol + surplus);
}

function render(ctx: ExportContext): Promise<Buffer> {
	const title = String(ctx.options.report_title ?? '');
	const doc = new PDFDocument({
		size: PAGE,
		margin: 0,
		bufferPages: true,
		font: loadFont() as unknown as string,
		info: {
			Title: title || 'Export',
			Creator: `svelteMyAdmin ${ctx.appVersion}`,
			Producer: `svelteMyAdmin ${ctx.appVersion}`,
			CreationDate: ctx.now
		}
	});
	const chunks: Buffer[] = [];
	doc.on('data', (c: Buffer) => chunks.push(c));
	const done = new Promise<Buffer>((resolve, reject) => {
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
	});

	const [W, H] = PAGE;
	const available = W - MARGIN_X * 2;
	const limit = H - BOTTOM;
	doc.fontSize(FONT_SIZE);

	const list_ = sections.get(ctx) ?? [];
	sections.delete(ctx);

	const pageHeader = (s: Section, widths: number[]): number => {
		doc.fillColor('#000').fontSize(TITLE_SIZE);
		doc.text(title, MARGIN_X, 18, { width: available, align: 'center', lineBreak: false });
		doc.fontSize(FONT_SIZE);
		doc.text(`Database: ${s.db},  Table: ${s.table},  Purpose: ${s.purpose}`, MARGIN_X, 50, {
			width: available,
			lineBreak: false
		});
		const h =
			Math.max(
				...s.titles.map((t, i) => doc.heightOfString(t, { width: widths[i] - PAD_X * 2 })),
				FONT_SIZE
			) +
			PAD_Y * 2;
		let x = MARGIN_X;
		doc.lineWidth(0.5);
		s.titles.forEach((t, i) => {
			doc.rect(x, TABLE_TOP, widths[i], h).fillAndStroke('#c8c8c8', '#000');
			doc.fillColor('#000').text(t, x + PAD_X, TABLE_TOP + PAD_Y, {
				width: widths[i] - PAD_X * 2,
				height: h - PAD_Y,
				align: 'center'
			});
			x += widths[i];
		});
		return TABLE_TOP + h;
	};

	let first = true;
	for (const s of list_) {
		if (s.titles.length === 0) continue;
		const widths = s.widths ?? fitWidths(doc, s.titles, s.rows, available);
		if (!first) doc.addPage();
		first = false;
		let y = pageHeader(s, widths);
		const bodyTop = y;
		const maxRow = limit - bodyTop;
		for (const row of s.rows) {
			let h = 0;
			s.titles.forEach((_, i) => {
				h = Math.max(
					h,
					doc.heightOfString(row[i] ?? '', { width: widths[i] - PAD_X * 2, align: s.aligns[i] })
				);
			});
			h = Math.min(h, maxRow - PAD_Y * 2) + PAD_Y * 2;
			if (y + h > limit) {
				doc.addPage();
				y = pageHeader(s, widths);
			}
			let x = MARGIN_X;
			s.titles.forEach((_, i) => {
				doc.rect(x, y, widths[i], h).stroke();
				doc.text(row[i] ?? '', x + PAD_X, y + PAD_Y, {
					width: widths[i] - PAD_X * 2,
					height: h - PAD_Y * 2,
					align: s.aligns[i],
					ellipsis: true
				});
				x += widths[i];
			});
			y += h;
		}
	}

	// Page numbers ("Page n/N", TCPDF default footer)
	const range = doc.bufferedPageRange();
	for (let i = 0; i < range.count; i++) {
		doc.switchToPage(range.start + i);
		doc.page.margins.bottom = 0;
		doc.fillColor('#000').fontSize(8);
		doc.text(`Page ${i + 1}/${range.count}`, MARGIN_X, H - 28, {
			width: available,
			align: 'center',
			lineBreak: false
		});
	}
	doc.end();
	return done;
}

const pdf: ExportPlugin = {
	id: 'pdf',
	label: N_('PDF'),
	extension: 'pdf',
	mimeType: 'application/pdf',
	scopes: ['server', 'database', 'table', 'raw'],
	supports: { structure: true, data: true },
	binary: true,
	options: [
		{
			kind: 'text',
			name: 'report_title',
			label: N_('Report title:'),
			default: '',
			group: 'general_opts'
		},
		{
			kind: 'radio',
			name: 'structure_or_data',
			label: N_('Dump table'),
			default: 'data',
			choices: [
				{ value: 'structure', label: N_('structure') },
				{ value: 'data', label: N_('data') },
				{ value: 'structure_and_data', label: N_('structure and data') }
			],
			group: 'dump_what'
		}
	],

	async header(ctx) {
		sections.set(ctx, []);
	},

	async footer(ctx) {
		await ctx.write(await render(ctx));
	},

	async structure(ctx, ref: ExportTableRef) {
		const info = await loadStructure(ctx.conn, ref.db, ref.table);
		const relation = ctx.options.relation !== false && info.foreigners.size > 0;
		const titles = ['Column', 'Type', 'Null', 'Default'];
		const widths = [90, 80, 40, 120];
		if (relation) {
			titles.push('Links to');
			widths.push(120);
		}
		titles.push('Comments');
		widths.push(120);
		const rows = info.columns.map((c) => {
			const r = [c.name, c.type || ' ', c.nullable ? 'Yes' : 'No', c.default];
			if (relation) {
				const fk = info.foreigners.get(c.name);
				r.push(fk ? `${fk.table} (${fk.field})` : '');
			}
			r.push(c.comment);
			return r.map(clean);
		});
		list(ctx).push({
			db: ref.db,
			table: ref.alias || ref.table,
			purpose: ref.kind === 'view' ? 'View structure' : 'Table structure',
			titles,
			widths,
			aligns: titles.map(() => 'left'),
			rows
		});
	},

	async data(ctx, data: ExportData) {
		// Binary BLOB columns are not displayed (width 0 in PHP).
		const shown = data.fields.map((f, i) => ({ f, i })).filter(({ f }) => !isBlobField(f));
		const rows: string[][] = [];
		for await (const r of data.rows) {
			rows.push(shown.map(({ f, i }) => cellString(f, r[i] ?? null)));
		}
		const raw = data.ref.table === '';
		list(ctx).push({
			db: raw ? '----' : data.ref.db,
			table: raw ? '----' : data.ref.alias || data.ref.table,
			purpose: raw ? 'Query result data' : 'Dumping data',
			titles: shown.map(({ f }) => clean(f.name)),
			aligns: shown.map(({ f }) => (INT_TYPES.has(f.type) ? 'right' : 'left')),
			rows
		});
	}
};

export default pdf;
