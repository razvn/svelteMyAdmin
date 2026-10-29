/**
 * Projection of geometries to SVG pixel space (pure), the counterpart of GisVisualization's scaling
 * (bounds, scale, padding). Three world mappings:
 *  - `cartesian`: plain x/y (y flipped), for any SRID but 4326;
 *  - `equirectangular`: lon/lat as x/y, for SRID 4326;
 *  - `mercator`: Web Mercator in 0..1 world units, used for SRID 4326 when map tiles are shown.
 */
import { primitives, type Geometry, type Position, type Primitive } from './wkt.ts';

export type ProjectionKind = 'cartesian' | 'equirectangular' | 'mercator';

export const MAX_MERCATOR_LAT = 85.0511287798;

export interface Bounds {
	minX: number;
	minY: number;
	maxX: number;
	maxY: number;
}

export function emptyBounds(): Bounds {
	return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

export const isEmptyBounds = (b: Bounds): boolean => b.minX > b.maxX;

export function extend(b: Bounds, p: Position): Bounds {
	return {
		minX: Math.min(b.minX, p[0]),
		minY: Math.min(b.minY, p[1]),
		maxX: Math.max(b.maxX, p[0]),
		maxY: Math.max(b.maxY, p[1])
	};
}

export function mergeBounds(a: Bounds, b: Bounds): Bounds {
	if (isEmptyBounds(a)) return b;
	if (isEmptyBounds(b)) return a;
	return {
		minX: Math.min(a.minX, b.minX),
		minY: Math.min(a.minY, b.minY),
		maxX: Math.max(a.maxX, b.maxX),
		maxY: Math.max(a.maxY, b.maxY)
	};
}

export function primitivePositions(p: Primitive): Position[] {
	return p.kind === 'point' ? [p.at] : p.kind === 'line' ? p.points : p.rings.flat();
}

/** Bounding box of a geometry in its own coordinates (empty when it has no coordinates). */
export function boundsOf(g: Geometry): Bounds {
	let b = emptyBounds();
	for (const prim of primitives(g)) for (const p of primitivePositions(prim)) b = extend(b, p);
	return b;
}

/** Only SRID 4326 is geographic; everything else is plain cartesian. */
export const projectionFor = (srid: number, tiles = false): ProjectionKind =>
	srid === 4326 ? (tiles ? 'mercator' : 'equirectangular') : 'cartesian';

/** Geometry coordinates => world coordinates (y grows downwards). */
export function toWorld(kind: ProjectionKind, p: Position): Position {
	switch (kind) {
		case 'cartesian':
			return [p[0], -p[1]];
		case 'equirectangular':
			return [p[0], -p[1]];
		case 'mercator': {
			const lat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, p[1]));
			const rad = (lat * Math.PI) / 180;
			return [(p[0] + 180) / 360, 0.5 - Math.log(Math.tan(Math.PI / 4 + rad / 2)) / (2 * Math.PI)];
		}
	}
}

export interface Viewport {
	kind: ProjectionKind;
	/** World units to pixels. */
	scale: number;
	/** Pixel offset of the world origin. */
	offsetX: number;
	offsetY: number;
	width: number;
	height: number;
	/** Geometry => pixel. */
	project(p: Position): Position;
	/** World => pixel. */
	worldToPixel(w: Position): Position;
}

export interface FitOptions {
	width: number;
	height: number;
	padding?: number;
	/** Span used for a single point / degenerate extent (in world units). */
	minSpan?: number;
}

/** Fit `bounds` (geometry coordinates) into `width` x `height` with `padding`, centred, uniform scale. */
export function fitViewport(bounds: Bounds, kind: ProjectionKind, opts: FitOptions): Viewport {
	const { width, height } = opts;
	const padding = opts.padding ?? 24;
	let minX = 0;
	let minY = 0;
	let maxX = 1;
	let maxY = 1;
	if (!isEmptyBounds(bounds)) {
		const a = toWorld(kind, [bounds.minX, bounds.minY]);
		const b = toWorld(kind, [bounds.maxX, bounds.maxY]);
		minX = Math.min(a[0], b[0]);
		maxX = Math.max(a[0], b[0]);
		minY = Math.min(a[1], b[1]);
		maxY = Math.max(a[1], b[1]);
	}
	const minSpan = opts.minSpan ?? (kind === 'mercator' ? 0.002 : 1);
	if (maxX - minX < minSpan) {
		const c = (minX + maxX) / 2;
		minX = c - minSpan / 2;
		maxX = c + minSpan / 2;
	}
	if (maxY - minY < minSpan) {
		const c = (minY + maxY) / 2;
		minY = c - minSpan / 2;
		maxY = c + minSpan / 2;
	}
	const availW = Math.max(width - 2 * padding, 1);
	const availH = Math.max(height - 2 * padding, 1);
	const scale = Math.min(availW / (maxX - minX), availH / (maxY - minY));
	const offsetX = (width - (maxX - minX) * scale) / 2 - minX * scale;
	const offsetY = (height - (maxY - minY) * scale) / 2 - minY * scale;
	const worldToPixel = (w: Position): Position => [w[0] * scale + offsetX, w[1] * scale + offsetY];
	return {
		kind,
		scale,
		offsetX,
		offsetY,
		width,
		height,
		worldToPixel,
		project: (p) => worldToPixel(toWorld(kind, p))
	};
}

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/** SVG path data of a line or polygon primitive; polygons are closed, holes use even-odd fill. */
export function primitivePath(p: Primitive, project: (p: Position) => Position): string {
	const ring = (pts: Position[], close: boolean): string => {
		const d = pts
			.map((q, i) => {
				const [x, y] = project(q);
				return `${i === 0 ? 'M' : 'L'}${fmt(x)} ${fmt(y)}`;
			})
			.join('');
		return close ? `${d}Z` : d;
	};
	if (p.kind === 'line') return ring(p.points, false);
	if (p.kind === 'polygon') return p.rings.map((r) => ring(r, true)).join('');
	return '';
}

/** A point to hang the label on: the first vertex of the first primitive. */
export function labelAnchor(g: Geometry): Position | null {
	const first = primitives(g)[0];
	if (!first) return null;
	if (first.kind === 'polygon') {
		const b = first.rings[0].reduce(extend, emptyBounds());
		return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
	}
	return primitivePositions(first)[0];
}

export interface Tile {
	z: number;
	x: number;
	y: number;
	/** Pixel rectangle (before any zoom / pan transform). */
	px: number;
	py: number;
	size: number;
}

/** Zoom level whose 256 px tiles roughly match the current scale. */
export function tileZoom(scale: number): number {
	return Math.max(0, Math.min(18, Math.round(Math.log2(Math.max(scale, 1) / 256))));
}

/**
 * Tiles covering the viewport (pixel rectangle `0..width x 0..height` before transform) for a
 * mercator viewport. Capped at `max` tiles.
 */
export function tilesFor(view: Viewport, max = 36): Tile[] {
	if (view.kind !== 'mercator') return [];
	const z = tileZoom(view.scale);
	const n = 2 ** z;
	const toWorldX = (px: number) => (px - view.offsetX) / view.scale;
	const toWorldY = (py: number) => (py - view.offsetY) / view.scale;
	const x0 = Math.max(0, Math.floor(toWorldX(0) * n));
	const x1 = Math.min(n - 1, Math.floor(toWorldX(view.width) * n));
	const y0 = Math.max(0, Math.floor(toWorldY(0) * n));
	const y1 = Math.min(n - 1, Math.floor(toWorldY(view.height) * n));
	const tiles: Tile[] = [];
	for (let y = y0; y <= y1; y++) {
		for (let x = x0; x <= x1; x++) {
			const [px, py] = view.worldToPixel([x / n, y / n]);
			tiles.push({ z, x, y, px, py, size: view.scale / n });
			if (tiles.length >= max) return tiles;
		}
	}
	return tiles;
}

export const tileUrl = (t: Pick<Tile, 'z' | 'x' | 'y'>): string =>
	`https://tile.openstreetmap.org/${t.z}/${t.x}/${t.y}.png`;
