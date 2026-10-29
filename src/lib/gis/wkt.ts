/**
 * WKT parser / writer for the seven OGC geometry types (pure).
 * Mirrors what libraries/classes/Gis/Gis*.php handle: POINT, LINESTRING, POLYGON, MULTIPOINT,
 * MULTILINESTRING, MULTIPOLYGON and GEOMETRYCOLLECTION (nested, incl. EMPTY). Z / M ordinates are
 * accepted and dropped: the visualization is 2-D.
 */

export type Position = [number, number];

export type Geometry =
	| { type: 'Point'; coordinates: Position | null }
	| { type: 'LineString'; coordinates: Position[] }
	| { type: 'Polygon'; coordinates: Position[][] }
	| { type: 'MultiPoint'; coordinates: Position[] }
	| { type: 'MultiLineString'; coordinates: Position[][] }
	| { type: 'MultiPolygon'; coordinates: Position[][][] }
	| { type: 'GeometryCollection'; geometries: Geometry[] };

export type GeometryType = Geometry['type'];

export const GEOMETRY_TYPES: readonly GeometryType[] = [
	'Point',
	'LineString',
	'Polygon',
	'MultiPoint',
	'MultiLineString',
	'MultiPolygon',
	'GeometryCollection'
];

export class WktError extends Error {}

const KEYWORDS: Record<string, GeometryType> = {
	POINT: 'Point',
	LINESTRING: 'LineString',
	POLYGON: 'Polygon',
	MULTIPOINT: 'MultiPoint',
	MULTILINESTRING: 'MultiLineString',
	MULTIPOLYGON: 'MultiPolygon',
	GEOMETRYCOLLECTION: 'GeometryCollection'
};

class Reader {
	pos = 0;
	constructor(readonly s: string) {}

	ws() {
		while (this.pos < this.s.length && /\s/.test(this.s[this.pos])) this.pos++;
	}
	peek(): string {
		this.ws();
		return this.s[this.pos] ?? '';
	}
	expect(ch: string) {
		if (this.peek() !== ch) this.fail(`expected "${ch}"`);
		this.pos++;
	}
	fail(msg: string): never {
		throw new WktError(`Invalid WKT at position ${this.pos}: ${msg}`);
	}
	word(): string {
		this.ws();
		const m = /^[A-Za-z]+/.exec(this.s.slice(this.pos));
		if (!m) return '';
		this.pos += m[0].length;
		return m[0].toUpperCase();
	}
	/** Optional `Z`, `M`, `ZM` modifier and `EMPTY`. */
	modifiers(): boolean {
		for (;;) {
			const save = this.pos;
			const w = this.word();
			if (w === 'EMPTY') return true;
			if (w === 'Z' || w === 'M' || w === 'ZM') continue;
			this.pos = save;
			return false;
		}
	}
	number(): number {
		this.ws();
		const m = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(this.s.slice(this.pos));
		if (!m) this.fail('expected a number');
		this.pos += m[0].length;
		return Number(m[0]);
	}
	position(): Position {
		const x = this.number();
		const y = this.number();
		// drop Z / M
		while (/[-+.\d]/.test(this.peek())) this.number();
		return [x, y];
	}
	/** `( item, item, ... )` */
	list<T>(item: () => T): T[] {
		this.expect('(');
		const out: T[] = [item()];
		while (this.peek() === ',') {
			this.pos++;
			out.push(item());
		}
		this.expect(')');
		return out;
	}
}

function parseBody(r: Reader, type: GeometryType): Geometry {
	const empty = r.modifiers();
	const line = (): Position[] => r.list(() => r.position());
	const ring = line;
	const poly = (): Position[][] => r.list(ring);
	switch (type) {
		case 'Point': {
			if (empty) return { type, coordinates: null };
			r.expect('(');
			const p = r.position();
			r.expect(')');
			return { type, coordinates: p };
		}
		case 'LineString':
			return { type, coordinates: empty ? [] : line() };
		case 'Polygon':
			return { type, coordinates: empty ? [] : poly() };
		case 'MultiPoint':
			if (empty) return { type, coordinates: [] };
			// both `MULTIPOINT(1 2, 3 4)` and `MULTIPOINT((1 2), (3 4))`
			return {
				type,
				coordinates: r.list(() => {
					if (r.peek() === '(') {
						r.pos++;
						const pos = r.position();
						r.expect(')');
						return pos;
					}
					return r.position();
				})
			};
		case 'MultiLineString':
			return { type, coordinates: empty ? [] : r.list(line) };
		case 'MultiPolygon':
			return { type, coordinates: empty ? [] : r.list(poly) };
		case 'GeometryCollection':
			return { type, geometries: empty ? [] : r.list(() => parseGeometry(r)) };
	}
}

function parseGeometry(r: Reader): Geometry {
	const word = r.word();
	const type = KEYWORDS[word];
	if (!type) r.fail(word ? `unknown geometry type ${word}` : 'expected a geometry type');
	return parseBody(r, type);
}

/** Parse WKT (an optional `SRID=n;` prefix is ignored). Throws `WktError`. */
export function parseWkt(text: string): Geometry {
	const r = new Reader(text.replace(/^\s*SRID\s*=\s*\d+\s*;/i, ''));
	const g = parseGeometry(r);
	if (r.peek() !== '') r.fail('unexpected trailing text');
	return g;
}

const pos = (p: Position): string => `${p[0]} ${p[1]}`;
const line = (l: Position[]): string => `(${l.map(pos).join(',')})`;
const poly = (p: Position[][]): string => `(${p.map(line).join(',')})`;

/** Serialize to WKT as MySQL's ST_AsText prints it. */
export function toWkt(g: Geometry): string {
	switch (g.type) {
		case 'Point':
			return g.coordinates ? `POINT(${pos(g.coordinates)})` : 'POINT EMPTY';
		case 'LineString':
			return g.coordinates.length ? `LINESTRING${line(g.coordinates)}` : 'LINESTRING EMPTY';
		case 'Polygon':
			return g.coordinates.length ? `POLYGON${poly(g.coordinates)}` : 'POLYGON EMPTY';
		case 'MultiPoint':
			return g.coordinates.length
				? `MULTIPOINT(${g.coordinates.map((p) => `(${pos(p)})`).join(',')})`
				: 'MULTIPOINT EMPTY';
		case 'MultiLineString':
			return g.coordinates.length
				? `MULTILINESTRING(${g.coordinates.map(line).join(',')})`
				: 'MULTILINESTRING EMPTY';
		case 'MultiPolygon':
			return g.coordinates.length
				? `MULTIPOLYGON(${g.coordinates.map(poly).join(',')})`
				: 'MULTIPOLYGON EMPTY';
		case 'GeometryCollection':
			return g.geometries.length
				? `GEOMETRYCOLLECTION(${g.geometries.map(toWkt).join(',')})`
				: 'GEOMETRYCOLLECTION EMPTY';
	}
}

/** A drawable primitive. */
export type Primitive =
	| { kind: 'point'; at: Position }
	| { kind: 'line'; points: Position[] }
	| { kind: 'polygon'; rings: Position[][] };

/** Flatten any geometry (collections recursively) into points, lines and polygons. */
export function primitives(g: Geometry): Primitive[] {
	switch (g.type) {
		case 'Point':
			return g.coordinates ? [{ kind: 'point', at: g.coordinates }] : [];
		case 'LineString':
			return g.coordinates.length ? [{ kind: 'line', points: g.coordinates }] : [];
		case 'Polygon':
			return g.coordinates.length ? [{ kind: 'polygon', rings: g.coordinates }] : [];
		case 'MultiPoint':
			return g.coordinates.map((at) => ({ kind: 'point' as const, at }));
		case 'MultiLineString':
			return g.coordinates.map((points) => ({ kind: 'line' as const, points }));
		case 'MultiPolygon':
			return g.coordinates.map((rings) => ({ kind: 'polygon' as const, rings }));
		case 'GeometryCollection':
			return g.geometries.flatMap(primitives);
	}
}
