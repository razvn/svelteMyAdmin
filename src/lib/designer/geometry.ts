/**
 * Card geometry shared by the canvas, the layout algorithms, the relation routing and the schema
 * exports (SVG / PDF), so that an export matches what the Designer shows.
 */
import type { CardView, DesignerColumn, DesignerTable, Position, Rect } from './types.ts';

export const HEADER_H = 30;
export const ROW_H = 22;
export const MIN_W = 170;
export const CHAR_W = 7;
export const PAD_W = 64;
export const GRID = 10;

export function isKeyColumn(c: DesignerColumn): boolean {
	return c.primary || c.unique || c.indexed || c.foreign;
}

/** Columns that are listed for a view. */
export function visibleColumns(table: DesignerTable, view: CardView): DesignerColumn[] {
	if (view.collapsed) return [];
	return view.keysOnly ? table.columns.filter(isKeyColumn) : table.columns;
}

/** Card width from the longest "name type" line (monospace estimate), unless a fixed width is given. */
export function tableWidth(table: DesignerTable, fixed?: number): number {
	if (fixed) return fixed;
	let longest = table.name.length + 4;
	for (const c of table.columns) longest = Math.max(longest, c.name.length + c.type.length + 2);
	return Math.max(MIN_W, Math.ceil(longest * CHAR_W + PAD_W));
}

export function tableHeight(table: DesignerTable, view: CardView): number {
	return HEADER_H + visibleColumns(table, view).length * ROW_H + (view.collapsed ? 0 : 4);
}

export function cardRect(
	table: DesignerTable,
	pos: Position,
	view: CardView,
	width?: number
): Rect {
	return { x: pos.x, y: pos.y, w: tableWidth(table, width), h: tableHeight(table, view) };
}

/**
 * Vertical anchor of a column on a card: the middle of its row, or the middle of the header when the
 * column is not listed (collapsed card, keys-only view).
 */
export function columnAnchorY(
	table: DesignerTable,
	column: string,
	rect: Rect,
	view: CardView
): number {
	const index = visibleColumns(table, view).findIndex((c) => c.name === column);
	if (index < 0) return rect.y + HEADER_H / 2;
	return rect.y + HEADER_H + index * ROW_H + ROW_H / 2;
}

export function snap(value: number, enabled: boolean, grid = GRID): number {
	return enabled ? Math.round(value / grid) * grid : Math.round(value);
}

export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
	return (
		a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap
	);
}

/** Bounding box of rects (a minimum of 1x1 at the origin when empty). */
export function bounds(rects: Rect[]): Rect {
	if (rects.length === 0) return { x: 0, y: 0, w: 1, h: 1 };
	const x1 = Math.min(...rects.map((r) => r.x));
	const y1 = Math.min(...rects.map((r) => r.y));
	const x2 = Math.max(...rects.map((r) => r.x + r.w));
	const y2 = Math.max(...rects.map((r) => r.y + r.h));
	return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}
