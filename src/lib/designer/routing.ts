/**
 * Relation line routing. A line leaves the source column on the side that faces the target card and
 * enters the target column with an arrowhead. "direct" is a smooth bezier curve, "angular" an
 * orthogonal polyline (phpMyAdmin's two line styles).
 */
import type { Rect } from './types.ts';

export type LineStyle = 'direct' | 'angular';

export interface Point {
	x: number;
	y: number;
}

export interface Route {
	/** Polyline through the line's corners (used for hit boxes and the label point). */
	points: Point[];
	/** SVG path data of the line. */
	path: string;
	/** SVG polygon points of the arrowhead. */
	arrow: string;
	/** Side the line enters the target: 1 = moving right (target is on the right), -1 = moving left. */
	direction: 1 | -1;
	/** Middle of the line. */
	mid: Point;
}

const STUB = 14;
const LOOP = 28;
const ARROW_LEN = 9;
const ARROW_HALF = 4.5;

const fmt = (n: number): string => String(Math.round(n * 100) / 100);
const dist = (a: Point, b: Point): number => Math.hypot(b.x - a.x, b.y - a.y);

export function routeRelation(
	from: Rect,
	fromY: number,
	to: Rect,
	toY: number,
	style: LineStyle
): Route {
	let sx: number;
	let tx: number;
	let direction: 1 | -1;
	let loop = false;
	if (from.x + from.w + STUB * 2 <= to.x) {
		sx = from.x + from.w;
		tx = to.x;
		direction = 1;
	} else if (to.x + to.w + STUB * 2 <= from.x) {
		sx = from.x;
		tx = to.x + to.w;
		direction = -1;
	} else {
		// overlapping columns of cards: leave and enter on the right side and loop around
		sx = from.x + from.w;
		tx = to.x + to.w;
		direction = -1;
		loop = true;
	}
	const out = sx === from.x ? -1 : 1;
	const s: Point = { x: sx, y: fromY };
	const t: Point = { x: tx, y: toY };
	const s1: Point = { x: sx + out * STUB, y: fromY };
	const t1: Point = { x: tx - direction * STUB, y: toY };

	let points: Point[];
	if (loop) {
		const x = Math.max(s.x, t.x) + LOOP;
		points = [s, { x, y: fromY }, { x, y: toY }, t];
	} else if (style === 'angular') {
		const mx = Math.round((s1.x + t1.x) / 2);
		points = [s, s1, { x: mx, y: fromY }, { x: mx, y: toY }, t1, t];
	} else {
		points = [s, s1, t1, t];
	}

	let path: string;
	if (style === 'angular' || loop) {
		path = 'M' + points.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join(' L');
	} else {
		const dx = Math.max(Math.abs(t.x - s.x) / 2, 30);
		path =
			`M${fmt(s.x)} ${fmt(s.y)} C${fmt(s.x + out * dx)} ${fmt(s.y)} ` +
			`${fmt(t.x - direction * dx)} ${fmt(t.y)} ${fmt(t.x)} ${fmt(t.y)}`;
	}

	// arrowhead: tip on the target edge, pointing into the card
	const back = -direction;
	const arrow = [
		`${fmt(t.x)},${fmt(t.y)}`,
		`${fmt(t.x + back * ARROW_LEN)},${fmt(t.y - ARROW_HALF)}`,
		`${fmt(t.x + back * ARROW_LEN)},${fmt(t.y + ARROW_HALF)}`
	].join(' ');

	return { points, path, arrow, direction, mid: polylineMid(points) };
}

/** Point halfway along the length of a polyline. */
export function polylineMid(points: Point[]): Point {
	let total = 0;
	for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i]);
	let left = total / 2;
	for (let i = 1; i < points.length; i++) {
		const d = dist(points[i - 1], points[i]);
		if (left <= d && d > 0) {
			const f = left / d;
			return {
				x: points[i - 1].x + (points[i].x - points[i - 1].x) * f,
				y: points[i - 1].y + (points[i].y - points[i - 1].y) * f
			};
		}
		left -= d;
	}
	return points[0];
}
