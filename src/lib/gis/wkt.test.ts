import { describe, expect, it } from 'vitest';
import { parseWkt, primitives, toWkt, WktError } from './wkt.ts';

describe('parseWkt', () => {
	it('parses a point', () => {
		expect(parseWkt('POINT(1 2)')).toEqual({ type: 'Point', coordinates: [1, 2] });
		expect(parseWkt(' point ( -1.5e1  +2.25 ) ')).toEqual({
			type: 'Point',
			coordinates: [-15, 2.25]
		});
	});
	it('parses a linestring', () => {
		expect(parseWkt('LINESTRING(0 0,1 1,2 0)')).toEqual({
			type: 'LineString',
			coordinates: [
				[0, 0],
				[1, 1],
				[2, 0]
			]
		});
	});
	it('parses a polygon with a hole', () => {
		const g = parseWkt('POLYGON((0 0,10 0,10 10,0 0),(2 2,3 2,3 3,2 2))');
		expect(g.type === 'Polygon' && g.coordinates).toHaveLength(2);
	});
	it('parses multipoint in both syntaxes', () => {
		const a = parseWkt('MULTIPOINT((1 2),(3 4))');
		const b = parseWkt('MULTIPOINT(1 2,3 4)');
		expect(a).toEqual(b);
		expect(a).toEqual({
			type: 'MultiPoint',
			coordinates: [
				[1, 2],
				[3, 4]
			]
		});
	});
	it('parses multilinestring and multipolygon', () => {
		const ml = parseWkt('MULTILINESTRING((0 0,1 1),(2 2,3 3))');
		expect(ml.type === 'MultiLineString' && ml.coordinates).toHaveLength(2);
		const mp = parseWkt(
			'MULTIPOLYGON(((0 0,1 0,1 1,0 0)),((5 5,6 5,6 6,5 5),(5.1 5.1,5.2 5.1,5.2 5.2,5.1 5.1)))'
		);
		expect(mp.type === 'MultiPolygon' && mp.coordinates.map((p) => p.length)).toEqual([1, 2]);
	});
	it('parses nested geometry collections', () => {
		const g = parseWkt(
			'GEOMETRYCOLLECTION(POINT(1 1),GEOMETRYCOLLECTION(LINESTRING(0 0,1 1),POINT EMPTY),POLYGON((0 0,1 0,1 1,0 0)))'
		);
		expect(g.type).toBe('GeometryCollection');
		expect(primitives(g).map((p) => p.kind)).toEqual(['point', 'line', 'polygon']);
	});
	it('parses EMPTY of every type', () => {
		for (const t of [
			'POINT',
			'LINESTRING',
			'POLYGON',
			'MULTIPOINT',
			'MULTILINESTRING',
			'MULTIPOLYGON',
			'GEOMETRYCOLLECTION'
		]) {
			expect(primitives(parseWkt(`${t} EMPTY`))).toEqual([]);
			expect(toWkt(parseWkt(`${t} EMPTY`))).toBe(`${t} EMPTY`);
		}
	});
	it('drops Z and M ordinates', () => {
		expect(parseWkt('POINT Z (1 2 3)')).toEqual({ type: 'Point', coordinates: [1, 2] });
		expect(parseWkt('LINESTRING ZM (1 2 3 4, 5 6 7 8)')).toEqual({
			type: 'LineString',
			coordinates: [
				[1, 2],
				[5, 6]
			]
		});
	});
	it('ignores an SRID prefix', () => {
		expect(parseWkt('SRID=4326;POINT(1 2)')).toEqual({ type: 'Point', coordinates: [1, 2] });
	});
	it('rejects garbage', () => {
		for (const bad of [
			'',
			'POINT',
			'POINT(1)',
			'POINT(1 2',
			'CIRCLE(1 2)',
			'POINT(1 2) x',
			'LINESTRING((1 2))'
		]) {
			expect(() => parseWkt(bad), bad).toThrow(WktError);
		}
	});
});

describe('toWkt', () => {
	it('round-trips', () => {
		for (const w of [
			'POINT(1 2)',
			'LINESTRING(0 0,1 1)',
			'POLYGON((0 0,1 0,1 1,0 0))',
			'MULTIPOINT((1 2),(3 4))',
			'MULTILINESTRING((0 0,1 1),(2 2,3 3))',
			'MULTIPOLYGON(((0 0,1 0,1 1,0 0)))',
			'GEOMETRYCOLLECTION(POINT(1 1),LINESTRING(0 0,1 1))'
		]) {
			expect(toWkt(parseWkt(w))).toBe(w);
		}
	});
});
