/**
 * Schema export model and SVG renderer (Plugins/Schema/SchemaSvg.php options). The same geometry and
 * routing as the canvas is used, so the file matches the Designer. Colours are literal here on purpose:
 * the file is standalone and has no access to the app's theme tokens.
 */
import {
	HEADER_H,
	ROW_H,
	bounds,
	cardRect,
	columnAnchorY,
	tableWidth,
	visibleColumns
} from './geometry.ts';
import { routeRelation, type Route } from './routing.ts';
import type { CardView, DesignerRelation, DesignerTable, Positions, Rect } from './types.ts';

export interface SchemaExportOptions {
	showColor: boolean;
	showKeys: boolean;
	showGrid: boolean;
	showDimension: boolean;
	sameWidth: boolean;
	orientation: 'L' | 'P';
	paper: string;
	withDoc: boolean;
	tableOrder: '' | 'name_asc' | 'name_desc';
}

export const DEFAULT_EXPORT_OPTIONS: SchemaExportOptions = {
	showColor: true,
	showKeys: false,
	showGrid: false,
	showDimension: false,
	sameWidth: false,
	orientation: 'L',
	paper: 'A4',
	withDoc: false,
	tableOrder: ''
};

export const PAPER_SIZES = ['A3', 'A4', 'A5', 'letter', 'legal'] as const;

export interface ExportCard {
	table: DesignerTable;
	rect: Rect;
	view: CardView;
	color: string;
}

export interface ExportLine {
	relation: DesignerRelation;
	route: Route;
	color: string;
}

export interface ExportModel {
	db: string;
	cards: ExportCard[];
	lines: ExportLine[];
	/** Bounding box of everything drawn, including a margin. */
	box: Rect;
	options: SchemaExportOptions;
}

const PALETTE = ['#4f46e5', '#0284c7', '#16a34a', '#d97706', '#db2777', '#7c3aed', '#0d9488'];
const MARGIN = 30;

export function buildExportModel(
	db: string,
	tables: DesignerTable[],
	relations: DesignerRelation[],
	positions: Positions,
	options: SchemaExportOptions
): ExportModel {
	let list = tables.filter((t) => positions[t.name]);
	if (options.tableOrder === 'name_asc')
		list = [...list].sort((a, b) => a.name.localeCompare(b.name));
	if (options.tableOrder === 'name_desc')
		list = [...list].sort((a, b) => b.name.localeCompare(a.name));
	const view: CardView = { collapsed: false, keysOnly: options.showKeys };
	const fixed = options.sameWidth
		? Math.max(0, ...list.map((t) => tableWidth(t))) || undefined
		: undefined;
	const cards: ExportCard[] = list.map((table, i) => ({
		table,
		view,
		rect: cardRect(table, positions[table.name], view, fixed),
		color: options.showColor ? PALETTE[i % PALETTE.length] : '#444444'
	}));
	const byName = new Map(cards.map((c) => [c.table.name, c]));
	const lines: ExportLine[] = [];
	for (const relation of relations) {
		const a = byName.get(relation.fromTable);
		const b = byName.get(relation.toTable);
		if (!a || !b) continue;
		const route = routeRelation(
			a.rect,
			columnAnchorY(a.table, relation.fromColumn, a.rect, view),
			b.rect,
			columnAnchorY(b.table, relation.toColumn, b.rect, view),
			'angular'
		);
		lines.push({ relation, route, color: options.showColor ? a.color : '#444444' });
	}
	const b = bounds(cards.map((c) => c.rect));
	const box: Rect = {
		x: Math.max(0, b.x - MARGIN),
		y: Math.max(0, b.y - MARGIN),
		w: b.w + MARGIN * 2 + 40,
		h: b.h + MARGIN * 2
	};
	return { db, cards, lines, box, options };
}

export const escapeXml = (s: string): string =>
	s
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		// eslint-disable-next-line no-control-regex
		.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

export function renderSvg(model: ExportModel): string {
	const { box, options } = model;
	const out: string[] = [];
	out.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
	out.push(
		`<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${Math.ceil(box.w)}" height="${Math.ceil(box.h)}" ` +
			`viewBox="${Math.floor(box.x)} ${Math.floor(box.y)} ${Math.ceil(box.w)} ${Math.ceil(box.h)}" ` +
			`font-family="DejaVu Sans, Verdana, sans-serif" font-size="12">`
	);
	out.push(`<title>${escapeXml(model.db)}</title>`);
	out.push(
		`<rect x="${Math.floor(box.x)}" y="${Math.floor(box.y)}" width="${Math.ceil(box.w)}" height="${Math.ceil(box.h)}" fill="#ffffff"/>`
	);
	if (options.showGrid) {
		const x2 = Math.ceil(box.x + box.w);
		const y2 = Math.ceil(box.y + box.h);
		out.push('<g stroke="#e5e7eb" stroke-width="1">');
		for (let x = Math.ceil(box.x / 50) * 50; x <= x2; x += 50) {
			out.push(`<line x1="${x}" y1="${Math.floor(box.y)}" x2="${x}" y2="${y2}"/>`);
		}
		for (let y = Math.ceil(box.y / 50) * 50; y <= y2; y += 50) {
			out.push(`<line x1="${Math.floor(box.x)}" y1="${y}" x2="${x2}" y2="${y}"/>`);
		}
		out.push('</g>');
	}
	for (const l of model.lines) {
		out.push(
			`<g class="relation" data-from="${escapeXml(l.relation.fromTable)}.${escapeXml(l.relation.fromColumn)}" ` +
				`data-to="${escapeXml(l.relation.toTable)}.${escapeXml(l.relation.toColumn)}">` +
				`<path d="${l.route.path}" fill="none" stroke="${l.color}" stroke-width="1.5"` +
				`${l.relation.kind === 'internal' ? ' stroke-dasharray="6 4"' : ''}/>` +
				`<polygon points="${l.route.arrow}" fill="${l.color}"/></g>`
		);
	}
	for (const c of model.cards) {
		const { rect: r, table } = c;
		out.push(`<g class="table" data-table="${escapeXml(table.name)}">`);
		out.push(
			`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="4" fill="#ffffff" stroke="${c.color}" stroke-width="1.5"/>`
		);
		out.push(
			`<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${HEADER_H}" rx="4" fill="${c.color}"/>`
		);
		const title = options.showDimension ? `${table.name} (${r.w}x${r.h})` : table.name;
		out.push(
			`<text x="${r.x + 8}" y="${r.y + HEADER_H / 2 + 4}" font-weight="bold" fill="#ffffff">${escapeXml(title)}</text>`
		);
		visibleColumns(table, c.view).forEach((col, i) => {
			const y = r.y + HEADER_H + i * ROW_H;
			const mark = col.primary
				? 'PK'
				: col.foreign
					? 'FK'
					: col.unique
						? 'UQ'
						: col.indexed
							? 'IX'
							: '';
			out.push(
				`<text x="${r.x + 8}" y="${y + ROW_H / 2 + 4}" ${col.primary ? 'text-decoration="underline" ' : ''}fill="#111827">${escapeXml(col.name)}</text>`
			);
			out.push(
				`<text x="${r.x + r.w - 8}" y="${y + ROW_H / 2 + 4}" text-anchor="end" fill="#6b7280" font-size="10">${escapeXml(mark ? `${mark} ${col.type}` : col.type)}</text>`
			);
		});
		out.push('</g>');
	}
	out.push('</svg>');
	return out.join('\n') + '\n';
}
