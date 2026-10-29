/**
 * Automatic layouts. Both are deterministic (no random numbers): the same input always gives the same
 * positions, so tests and the saved pages are stable.
 */
import { rectsOverlap } from './geometry.ts';
import type { Position, Positions, Rect } from './types.ts';

export interface LayoutNode {
	name: string;
	w: number;
	h: number;
}

export interface LayoutEdge {
	from: string;
	to: string;
}

export interface GridOptions {
	/** Wrap to a new row beyond this width. */
	maxWidth?: number;
	gap?: number;
	origin?: Position;
}

/** Left-to-right rows of cards, in the order of `nodes`. */
export function gridLayout(nodes: LayoutNode[], options: GridOptions = {}): Positions {
	const maxWidth = options.maxWidth ?? 1200;
	const gap = options.gap ?? 40;
	const origin = options.origin ?? { x: 40, y: 40 };
	const out: Positions = {};
	let x = origin.x;
	let y = origin.y;
	let rowH = 0;
	for (const n of nodes) {
		if (x > origin.x && x + n.w > origin.x + maxWidth) {
			x = origin.x;
			y += rowH + gap;
			rowH = 0;
		}
		out[n.name] = { x, y };
		x += n.w + gap;
		rowH = Math.max(rowH, n.h);
	}
	return out;
}

export interface ForceOptions extends GridOptions {
	iterations?: number;
}

/**
 * Force-directed layout (Fruchterman-Reingold style): related tables attract, all tables repel; the start
 * is the grid layout. Overlaps are resolved at the end and everything is shifted to the origin.
 */
export function forceLayout(
	nodes: LayoutNode[],
	edges: LayoutEdge[],
	options: ForceOptions = {}
): Positions {
	const n = nodes.length;
	if (n === 0) return {};
	const gap = options.gap ?? 40;
	const origin = options.origin ?? { x: 40, y: 40 };
	const start = gridLayout(nodes, { ...options, maxWidth: options.maxWidth ?? 900 });
	if (n === 1 || edges.length === 0) return start;

	const index = new Map(nodes.map((node, i) => [node.name, i]));
	const cx = nodes.map((node) => start[node.name].x + node.w / 2);
	const cy = nodes.map((node) => start[node.name].y + node.h / 2);
	const pairs: [number, number][] = [];
	for (const e of edges) {
		const a = index.get(e.from);
		const b = index.get(e.to);
		if (a !== undefined && b !== undefined && a !== b) pairs.push([a, b]);
	}
	const avg = nodes.reduce((s, node) => s + Math.max(node.w, node.h), 0) / n;
	const k = avg + gap * 2;
	const iterations = options.iterations ?? 250;
	let temperature = k;

	for (let it = 0; it < iterations; it++) {
		const dx = new Array<number>(n).fill(0);
		const dy = new Array<number>(n).fill(0);
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				let ex = cx[i] - cx[j];
				let ey = cy[i] - cy[j];
				if (ex === 0 && ey === 0) {
					// identical centres: separate along a fixed, index based direction
					ex = 0.01 * (i + 1);
					ey = 0.01 * (j + 1);
				}
				const d = Math.hypot(ex, ey);
				const f = (k * k) / d;
				dx[i] += (ex / d) * f;
				dy[i] += (ey / d) * f;
				dx[j] -= (ex / d) * f;
				dy[j] -= (ey / d) * f;
			}
		}
		for (const [a, b] of pairs) {
			const ex = cx[a] - cx[b];
			const ey = cy[a] - cy[b];
			const d = Math.hypot(ex, ey) || 1;
			const f = (d * d) / k;
			dx[a] -= (ex / d) * f;
			dy[a] -= (ey / d) * f;
			dx[b] += (ex / d) * f;
			dy[b] += (ey / d) * f;
		}
		// gravity towards the centroid keeps unrelated tables (and components) close together
		const mx = cx.reduce((a, b) => a + b, 0) / n;
		const my = cy.reduce((a, b) => a + b, 0) / n;
		for (let i = 0; i < n; i++) {
			dx[i] -= (cx[i] - mx) * 0.03 * k;
			dy[i] -= (cy[i] - my) * 0.03 * k;
		}
		for (let i = 0; i < n; i++) {
			const d = Math.hypot(dx[i], dy[i]) || 1;
			const step = Math.min(d, temperature);
			cx[i] += (dx[i] / d) * step;
			cy[i] += (dy[i] / d) * step;
		}
		temperature *= 0.97;
	}

	const rects: Rect[] = nodes.map((node, i) => ({
		x: cx[i] - node.w / 2,
		y: cy[i] - node.h / 2,
		w: node.w,
		h: node.h
	}));
	// resolve overlaps: push the later card away along the axis of least penetration
	for (let pass = 0; pass < 100; pass++) {
		let moved = false;
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				const a = rects[i];
				const b = rects[j];
				if (!rectsOverlap(a, b, gap)) continue;
				const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) + gap;
				const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) + gap;
				if (ox < oy) b.x += (b.x + b.w / 2 >= a.x + a.w / 2 ? 1 : -1) * ox;
				else b.y += (b.y + b.h / 2 >= a.y + a.h / 2 ? 1 : -1) * oy;
				moved = true;
			}
		}
		if (!moved) break;
	}
	const minX = Math.min(...rects.map((r) => r.x));
	const minY = Math.min(...rects.map((r) => r.y));
	const out: Positions = {};
	nodes.forEach((node, i) => {
		out[node.name] = {
			x: Math.round(rects[i].x - minX + origin.x),
			y: Math.round(rects[i].y - minY + origin.y)
		};
	});
	return out;
}

/** First free slot for a new card: scan rows left to right below/next to the existing rects. */
export function nextFreePosition(
	existing: Rect[],
	size: { w: number; h: number },
	options: GridOptions = {}
): Position {
	const maxWidth = options.maxWidth ?? 1200;
	const gap = options.gap ?? 40;
	const origin = options.origin ?? { x: 40, y: 40 };
	const step = 20;
	for (let y = origin.y; y < origin.y + 20000; y += step) {
		for (let x = origin.x; x + size.w <= origin.x + maxWidth; x += step) {
			const r = { x, y, w: size.w, h: size.h };
			if (!existing.some((e) => rectsOverlap(r, e, gap - step))) return { x, y };
		}
	}
	return origin;
}
