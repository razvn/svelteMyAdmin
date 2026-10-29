/**
 * Model of the (simplified) GIS data editor of Insert/Edit, see phpMyAdmin's gis_data_editor:
 * pick a geometry type, edit the coordinate lists, get WKT for ST_GeomFromText.
 */
import { parseWkt, toWkt, WktError, type Geometry, type Position } from './wkt.ts';

/** Types edited as coordinate lists; the others are entered as WKT text. */
export type EditorType =
	| 'Point'
	| 'LineString'
	| 'Polygon'
	| 'MultiPoint'
	| 'MultiLineString'
	| 'MultiPolygon'
	| 'GeometryCollection';

export const EDITOR_TYPES: { value: EditorType; label: string }[] = [
	{ value: 'Point', label: 'Point' },
	{ value: 'LineString', label: 'LineString' },
	{ value: 'Polygon', label: 'Polygon' },
	{ value: 'MultiPoint', label: 'MultiPoint' },
	{ value: 'MultiLineString', label: 'MultiLineString' },
	{ value: 'MultiPolygon', label: 'MultiPolygon (WKT)' },
	{ value: 'GeometryCollection', label: 'GeometryCollection (WKT)' }
];

export interface Coordinate {
	x: string;
	y: string;
}

/** A part is a point list: the point itself, a line, a ring, ... */
export type Part = Coordinate[];

export const isTextType = (t: EditorType): boolean =>
	t === 'MultiPolygon' || t === 'GeometryCollection';

/** Minimum points per part. */
export const minPoints = (t: EditorType): number =>
	t === 'LineString' || t === 'MultiLineString' ? 2 : t === 'Polygon' ? 4 : 1;

/** Types with more than one part (rings of a polygon, lines of a multi-linestring). */
export const hasParts = (t: EditorType): boolean => t === 'Polygon' || t === 'MultiLineString';

/** Types whose point list can grow. */
export const growsPoints = (t: EditorType): boolean => t !== 'Point';

/** Empty parts for a type, with the minimum number of empty points. */
export function emptyParts(t: EditorType): Part[] {
	if (isTextType(t)) return [];
	const n = minPoints(t);
	return [Array.from({ length: n }, () => ({ x: '', y: '' }))];
}

const toCoords = (ps: Position[]): Part => ps.map((p) => ({ x: String(p[0]), y: String(p[1]) }));

/** Read a WKT value into the editor model; unreadable input falls back to a text editor type. */
export function fromWkt(wkt: string): { type: EditorType; parts: Part[]; text: string } {
	try {
		const g = parseWkt(wkt);
		switch (g.type) {
			case 'Point':
				return { type: 'Point', parts: [g.coordinates ? toCoords([g.coordinates]) : []], text: '' };
			case 'LineString':
			case 'MultiPoint':
				return { type: g.type, parts: [toCoords(g.coordinates)], text: '' };
			case 'Polygon':
			case 'MultiLineString':
				return { type: g.type, parts: g.coordinates.map(toCoords), text: '' };
			default:
				return { type: g.type, parts: [], text: toWkt(g) };
		}
	} catch {
		return { type: 'Point', parts: emptyParts('Point'), text: '' };
	}
}

export type BuildResult = { ok: true; wkt: string } | { ok: false; error: string };

const num = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

function positions(part: Part): Position[] | string {
	const out: Position[] = [];
	for (const c of part) {
		if (c.x.trim() === '' && c.y.trim() === '') continue;
		if (!num.test(c.x.trim()) || !num.test(c.y.trim())) return 'Coordinates must be numbers.';
		out.push([Number(c.x), Number(c.y)]);
	}
	return out;
}

/** WKT for the editor state, or the first problem found. */
export function buildWkt(type: EditorType, parts: Part[], text = ''): BuildResult {
	if (isTextType(type)) {
		try {
			const g = parseWkt(text);
			if (g.type !== type) return { ok: false, error: `Expected a ${type.toUpperCase()} value.` };
			return { ok: true, wkt: toWkt(g) };
		} catch (e) {
			return { ok: false, error: e instanceof WktError ? e.message : 'Invalid WKT.' };
		}
	}
	const lists: Position[][] = [];
	for (const part of parts) {
		const ps = positions(part);
		if (typeof ps === 'string') return { ok: false, error: ps };
		lists.push(ps);
	}
	const min = minPoints(type);
	let g: Geometry;
	switch (type) {
		case 'Point':
			if (lists[0]?.length !== 1) return { ok: false, error: 'A point needs X and Y.' };
			g = { type, coordinates: lists[0][0] };
			break;
		case 'LineString':
		case 'MultiPoint':
			if (!lists[0] || lists[0].length < min) {
				return {
					ok: false,
					error: `At least ${min} ${min === 1 ? 'point is' : 'points are'} needed.`
				};
			}
			g = { type, coordinates: lists[0] };
			break;
		case 'MultiLineString':
		case 'Polygon': {
			const used = lists.filter((l) => l.length > 0);
			if (used.length === 0 || used.some((l) => l.length < min)) {
				return {
					ok: false,
					error: `Every ${type === 'Polygon' ? 'ring' : 'line'} needs at least ${min} points.`
				};
			}
			if (type === 'Polygon') {
				const open = used.find((l) => {
					const a = l[0];
					const b = l[l.length - 1];
					return a[0] !== b[0] || a[1] !== b[1];
				});
				if (open) return { ok: false, error: 'A ring must end at its first point.' };
				g = { type, coordinates: used };
			} else g = { type, coordinates: used };
			break;
		}
		default:
			return { ok: false, error: 'Unsupported type.' };
	}
	return { ok: true, wkt: toWkt(g) };
}
