/**
 * Schema export as PDF (Plugins/Schema/Pdf/*): the diagram of the page scaled to fit the paper, and
 * optionally a data dictionary (one section per table). Rendered with pdfkit and the embedded DejaVu Sans.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import PDFDocument from 'pdfkit';
import { HEADER_H, ROW_H, visibleColumns } from '#lib/designer/geometry.ts';
import type { ExportModel } from '#lib/designer/export.ts';
import type { DesignerRelation } from '#lib/designer/types.ts';

const PAPER: Record<string, [number, number]> = {
	A3: [841.89, 1190.55],
	A4: [595.28, 841.89],
	A5: [419.53, 595.28],
	letter: [612, 792],
	legal: [612, 1008]
};

let fontData: Buffer | undefined;
function loadFont(): Buffer {
	fontData ??= readFileSync(
		createRequire(import.meta.url).resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf')
	);
	return fontData;
}

const clean = (s: string): string =>
	// eslint-disable-next-line no-control-regex
	s.replace(/[\u0000-\u001F\u007F]/g, ' ');

export function renderPdf(model: ExportModel, appVersion = ''): Promise<Buffer> {
	const { options } = model;
	const [pw, ph] = PAPER[options.paper] ?? PAPER.A4;
	const size: [number, number] = options.orientation === 'L' ? [ph, pw] : [pw, ph];
	const doc = new PDFDocument({
		size,
		margin: 0,
		font: loadFont() as unknown as string,
		info: { Title: model.db, Creator: `svelteMyAdmin ${appVersion}`.trim() }
	});
	const chunks: Buffer[] = [];
	doc.on('data', (c: Buffer) => chunks.push(c));
	const done = new Promise<Buffer>((resolve, reject) => {
		doc.on('end', () => resolve(Buffer.concat(chunks)));
		doc.on('error', reject);
	});

	const margin = 30;
	const top = 50;
	doc.fontSize(14).fillColor('#000').text(model.db, margin, 22, { lineBreak: false });
	const availW = size[0] - margin * 2;
	const availH = size[1] - top - margin;
	const { box } = model;
	const scale = Math.min(1, availW / box.w, availH / box.h);

	doc.save();
	doc.translate(margin, top).scale(scale).translate(-box.x, -box.y);
	if (options.showGrid) {
		doc.lineWidth(0.5).strokeColor('#dddddd');
		for (let x = Math.ceil(box.x / 50) * 50; x <= box.x + box.w; x += 50) {
			doc
				.moveTo(x, box.y)
				.lineTo(x, box.y + box.h)
				.stroke();
		}
		for (let y = Math.ceil(box.y / 50) * 50; y <= box.y + box.h; y += 50) {
			doc
				.moveTo(box.x, y)
				.lineTo(box.x + box.w, y)
				.stroke();
		}
	}
	for (const l of model.lines) {
		doc.lineWidth(1.5).strokeColor(l.color);
		if (l.relation.kind === 'internal') doc.dash(5, { space: 3 });
		doc.path(l.route.path).stroke();
		doc.undash();
		const pts = l.route.arrow.split(' ').map((p) => p.split(',').map(Number) as [number, number]);
		doc.polygon(...pts).fill(l.color);
	}
	for (const c of model.cards) {
		const { rect: r, table } = c;
		doc.lineWidth(1.2).rect(r.x, r.y, r.w, r.h).fillAndStroke('#ffffff', c.color);
		doc.rect(r.x, r.y, r.w, HEADER_H).fill(c.color);
		doc.fillColor('#ffffff').fontSize(11);
		doc.text(
			clean(options.showDimension ? `${table.name} (${r.w}x${r.h})` : table.name),
			r.x + 8,
			r.y + 9,
			{
				width: r.w - 16,
				lineBreak: false
			}
		);
		doc.fontSize(9);
		visibleColumns(table, c.view).forEach((col, i) => {
			const y = r.y + HEADER_H + i * ROW_H + 7;
			doc
				.fillColor('#111111')
				.text(clean(col.name), r.x + 8, y, { lineBreak: false, underline: col.primary });
			doc
				.fillColor('#666666')
				.fontSize(7)
				.text(clean(col.type), r.x + r.w / 2, y + 1, {
					width: r.w / 2 - 8,
					align: 'right',
					lineBreak: false
				});
			doc.fontSize(9);
		});
	}
	doc.restore();

	if (options.withDoc) {
		for (const c of model.cards) {
			doc.addPage();
			doc
				.fillColor('#000')
				.fontSize(14)
				.text(clean(c.table.name), margin, 24, { lineBreak: false });
			const links = (name: string): string =>
				model.lines
					.filter(
						(l: { relation: DesignerRelation }) =>
							l.relation.fromTable === c.table.name && l.relation.fromColumn === name
					)
					.map((l) => `${l.relation.toTable} (${l.relation.toColumn})`)
					.join(', ');
			const widths = [0.25, 0.2, 0.08, 0.17, 0.3].map((f) => f * availW);
			const head = ['Column', 'Type', 'Null', 'Default', 'Links to'];
			let y = 54;
			const row = (cells: string[], header: boolean) => {
				let x = margin;
				doc.fontSize(9);
				cells.forEach((cell, i) => {
					doc.rect(x, y, widths[i], 16).fillAndStroke(header ? '#c8c8c8' : '#ffffff', '#000');
					doc.fillColor('#000').text(clean(cell), x + 3, y + 4, {
						width: widths[i] - 6,
						height: 10,
						lineBreak: false,
						ellipsis: true
					});
					x += widths[i];
				});
				y += 16;
			};
			row(head, true);
			for (const col of c.table.columns) {
				if (y > size[1] - margin - 16) {
					doc.addPage();
					y = 30;
					row(head, true);
				}
				row(
					[
						col.name,
						col.type,
						col.nullable ? 'Yes' : 'No',
						col.default ?? (col.nullable ? 'NULL' : ''),
						links(col.name)
					],
					false
				);
			}
		}
	}
	doc.end();
	return done;
}
