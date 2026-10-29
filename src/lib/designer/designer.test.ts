import { describe, expect, it } from 'vitest';
import { autoLayout } from './auto.ts';
import { DEFAULT_EXPORT_OPTIONS, buildExportModel, renderSvg } from './export.ts';
import { cardRect, columnAnchorY, rectsOverlap, snap, HEADER_H, ROW_H } from './geometry.ts';
import { forceLayout, gridLayout, nextFreePosition } from './layout.ts';
import { routeRelation } from './routing.ts';
import { DEFAULT_VIEW, mergeSetting, parseSettings, settingValue, toView } from './settings.ts';
import type { DesignerRelation, DesignerTable } from './types.ts';

const col = (name: string, extra: Partial<DesignerTable['columns'][number]> = {}) => ({
	name,
	type: 'int',
	nullable: false,
	default: null,
	primary: false,
	unique: false,
	indexed: false,
	foreign: false,
	...extra
});
const authors: DesignerTable = {
	name: 'authors',
	engine: 'InnoDB',
	displayField: '',
	columns: [col('id', { primary: true }), col('name', { type: 'varchar(100)' })]
};
const books: DesignerTable = {
	name: 'books',
	engine: 'InnoDB',
	displayField: '',
	columns: [col('id', { primary: true }), col('author_id', { foreign: true }), col('title')]
};
const rel: DesignerRelation = {
	id: 'fk:books:fk_a:0',
	kind: 'fk',
	fromTable: 'books',
	fromColumn: 'author_id',
	toTable: 'authors',
	toColumn: 'id'
};

describe('layout', () => {
	const nodes = ['a', 'b', 'c', 'd', 'e'].map((name) => ({ name, w: 200, h: 100 }));
	const edges = [
		{ from: 'a', to: 'b' },
		{ from: 'b', to: 'c' },
		{ from: 'a', to: 'e' }
	];

	it('grid layout wraps rows', () => {
		const p = gridLayout(nodes, { maxWidth: 500, gap: 40, origin: { x: 0, y: 0 } });
		expect(p.a).toEqual({ x: 0, y: 0 });
		expect(p.b).toEqual({ x: 240, y: 0 });
		expect(p.c).toEqual({ x: 0, y: 140 });
	});

	it('force layout is deterministic and has no overlaps', () => {
		const one = forceLayout(nodes, edges);
		const two = forceLayout(nodes, edges);
		expect(one).toEqual(two);
		const rects = nodes.map((n) => ({ ...one[n.name], w: n.w, h: n.h }));
		for (let i = 0; i < rects.length; i++)
			for (let j = i + 1; j < rects.length; j++)
				expect(rectsOverlap(rects[i], rects[j])).toBe(false);
		expect(Math.min(...rects.map((r) => r.x))).toBeGreaterThanOrEqual(0);
	});

	it('force layout stays compact', () => {
		const p = forceLayout(nodes, edges.slice(0, 1));
		for (const n of nodes) {
			expect(p[n.name].x).toBeLessThan(1500);
			expect(p[n.name].y).toBeLessThan(1500);
		}
	});

	it('autoLayout places every table', () => {
		const p = autoLayout([authors, books], [rel]);
		expect(Object.keys(p).sort()).toEqual(['authors', 'books']);
	});

	it('nextFreePosition avoids existing cards', () => {
		const p = nextFreePosition([{ x: 40, y: 40, w: 200, h: 100 }], { w: 200, h: 100 });
		expect(rectsOverlap({ ...p, w: 200, h: 100 }, { x: 40, y: 40, w: 200, h: 100 })).toBe(false);
	});
});

describe('routing', () => {
	const a = { x: 0, y: 0, w: 100, h: 100 };
	const b = { x: 300, y: 50, w: 100, h: 100 };

	it('goes from the right side of the left card into the left side of the right card', () => {
		const r = routeRelation(a, 40, b, 90, 'angular');
		expect(r.points[0]).toEqual({ x: 100, y: 40 });
		expect(r.points.at(-1)).toEqual({ x: 300, y: 90 });
		expect(r.direction).toBe(1);
		// orthogonal: every segment is horizontal or vertical
		for (let i = 1; i < r.points.length; i++) {
			const p = r.points[i - 1];
			const q = r.points[i];
			expect(p.x === q.x || p.y === q.y).toBe(true);
		}
		expect(r.arrow.startsWith('300,90')).toBe(true);
	});

	it('mirrors when the target is on the left and uses a bezier for direct lines', () => {
		const r = routeRelation(b, 90, a, 40, 'direct');
		expect(r.points[0].x).toBe(300);
		expect(r.points.at(-1)).toEqual({ x: 100, y: 40 });
		expect(r.direction).toBe(-1);
		expect(r.path).toContain('C');
	});

	it('loops around the right side when the cards overlap horizontally', () => {
		const r = routeRelation(a, 40, { x: 20, y: 200, w: 100, h: 50 }, 220, 'direct');
		expect(Math.max(...r.points.map((p) => p.x))).toBeGreaterThan(120);
		expect(r.points).toHaveLength(4);
	});
});

describe('geometry', () => {
	it('anchors columns on their row, or the header when hidden', () => {
		const full = { collapsed: false, keysOnly: false };
		const rect = cardRect(books, { x: 10, y: 20 }, full);
		expect(columnAnchorY(books, 'author_id', rect, full)).toBe(20 + HEADER_H + ROW_H + ROW_H / 2);
		expect(columnAnchorY(books, 'title', rect, { collapsed: false, keysOnly: true })).toBe(
			20 + HEADER_H / 2
		);
		expect(rect.h).toBeGreaterThan(
			cardRect(books, { x: 0, y: 0 }, { collapsed: true, keysOnly: false }).h
		);
	});

	it('snaps to the grid only when enabled', () => {
		expect(snap(14, true)).toBe(10);
		expect(snap(16, true)).toBe(20);
		expect(snap(14.4, false)).toBe(14);
	});
});

describe('designer_settings JSON compatibility', () => {
	it('reads phpMyAdmin values', () => {
		const stored = parseSettings(
			'{"angular_direct":"angular","snap_to_grid":"on","relation_lines":"false","small_big_all":"v","side_menu":"true","pin_text":"true","full_screen":"on"}'
		);
		expect(toView(stored)).toEqual({
			angular: true,
			snapToGrid: true,
			relationLines: false,
			fullScreen: true,
			small: true,
			sideMenu: true,
			pinText: true
		});
	});

	it('tolerates garbage and boolean values', () => {
		expect(parseSettings('nope')).toEqual({});
		expect(parseSettings('[1]')).toEqual({});
		expect(parseSettings('{"pin_text":true,"x":1}')).toEqual({ pin_text: 'true' });
		expect(toView({})).toEqual(DEFAULT_VIEW);
	});

	it('merges one key and keeps the others', () => {
		const json = mergeSetting('{"other":1,"pin_text":"false"}', 'pin_text', 'true');
		expect(JSON.parse(json)).toEqual({ other: 1, pin_text: 'true' });
		expect(JSON.parse(mergeSetting(null, 'snap_to_grid', 'on'))).toEqual({ snap_to_grid: 'on' });
	});

	it('writes the strings phpMyAdmin writes', () => {
		const v = { ...DEFAULT_VIEW, angular: true, small: true };
		expect(settingValue('angular_direct', v)).toBe('angular');
		expect(settingValue('small_big_all', v)).toBe('v');
		expect(settingValue('relation_lines', v)).toBe('true');
		expect(settingValue('snap_to_grid', v)).toBe('off');
	});
});

describe('SVG export', () => {
	it('draws the cards and relations of the positioned tables only', () => {
		const model = buildExportModel(
			'sma_test',
			[authors, books, { ...authors, name: 'hidden' }],
			[rel],
			{ authors: { x: 400, y: 40 }, books: { x: 40, y: 40 } },
			DEFAULT_EXPORT_OPTIONS
		);
		const svg = renderSvg(model);
		expect(svg.startsWith('<?xml')).toBe(true);
		expect(svg).toContain('data-table="authors"');
		expect(svg).toContain('data-table="books"');
		expect(svg).not.toContain('hidden');
		expect(svg).toContain('data-from="books.author_id"');
		expect(svg.trim().endsWith('</svg>')).toBe(true);
	});

	it('escapes names', () => {
		const t = { ...authors, name: 'a<&>"b' };
		const svg = renderSvg(
			buildExportModel('d', [t], [], { 'a<&>"b': { x: 0, y: 0 } }, DEFAULT_EXPORT_OPTIONS)
		);
		expect(svg).toContain('a&lt;&amp;&gt;&quot;b');
	});
});
