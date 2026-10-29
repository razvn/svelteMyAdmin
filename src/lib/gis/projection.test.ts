import { describe, expect, it } from 'vitest';
import {
	boundsOf,
	fitViewport,
	isEmptyBounds,
	labelAnchor,
	mergeBounds,
	primitivePath,
	projectionFor,
	tilesFor,
	tileUrl,
	tileZoom,
	toWorld
} from './projection.ts';
import { parseWkt, primitives } from './wkt.ts';

describe('bounds', () => {
	it('covers every type', () => {
		expect(boundsOf(parseWkt('POINT(1 2)'))).toEqual({ minX: 1, minY: 2, maxX: 1, maxY: 2 });
		expect(boundsOf(parseWkt('GEOMETRYCOLLECTION(POINT(5 -1),LINESTRING(0 0,2 9))'))).toEqual({
			minX: 0,
			minY: -1,
			maxX: 5,
			maxY: 9
		});
		expect(isEmptyBounds(boundsOf(parseWkt('POLYGON EMPTY')))).toBe(true);
	});
	it('merges', () => {
		const a = boundsOf(parseWkt('POINT(0 0)'));
		const b = boundsOf(parseWkt('POINT(4 3)'));
		expect(mergeBounds(a, b)).toEqual({ minX: 0, minY: 0, maxX: 4, maxY: 3 });
		expect(mergeBounds(boundsOf(parseWkt('POINT EMPTY')), a)).toEqual(a);
	});
});

describe('projection', () => {
	it('picks the mapping from the SRID', () => {
		expect(projectionFor(4326)).toBe('equirectangular');
		expect(projectionFor(4326, true)).toBe('mercator');
		expect(projectionFor(0, true)).toBe('cartesian');
		expect(projectionFor(3857)).toBe('cartesian');
	});
	it('fits with padding, flips y and keeps the aspect ratio', () => {
		const v = fitViewport({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 'cartesian', {
			width: 120,
			height: 120,
			padding: 10
		});
		expect(v.scale).toBe(10);
		expect(v.project([0, 0])).toEqual([10, 110]);
		expect(v.project([10, 10])).toEqual([110, 10]);
	});
	it('centres a wide extent', () => {
		const v = fitViewport({ minX: 0, minY: 0, maxX: 20, maxY: 10 }, 'cartesian', {
			width: 220,
			height: 220,
			padding: 10
		});
		expect(v.scale).toBe(10);
		const [, y0] = v.project([0, 0]);
		const [, y1] = v.project([0, 10]);
		expect((y0 + y1) / 2).toBe(110);
	});
	it('handles a single point', () => {
		const v = fitViewport(boundsOf(parseWkt('POINT(3 4)')), 'cartesian', {
			width: 100,
			height: 100
		});
		expect(v.project([3, 4])).toEqual([50, 50]);
	});
	it('maps mercator corners', () => {
		expect(toWorld('mercator', [-180, 0])[0]).toBeCloseTo(0);
		expect(toWorld('mercator', [180, 0])[0]).toBeCloseTo(1);
		expect(toWorld('mercator', [0, 0])[1]).toBeCloseTo(0.5);
		expect(toWorld('mercator', [0, 85])[1]).toBeLessThan(0.01);
	});
	it('builds path data', () => {
		const p = primitives(parseWkt('POLYGON((0 0,10 0,10 10,0 0))'))[0];
		const v = fitViewport({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, 'cartesian', {
			width: 120,
			height: 120,
			padding: 10
		});
		expect(primitivePath(p, v.project)).toBe('M10 110L110 110L110 10L10 110Z');
	});
	it('anchors labels', () => {
		expect(labelAnchor(parseWkt('POINT(1 2)'))).toEqual([1, 2]);
		expect(labelAnchor(parseWkt('POLYGON((0 0,4 0,4 2,0 0))'))).toEqual([2, 1]);
		expect(labelAnchor(parseWkt('POINT EMPTY'))).toBeNull();
	});
});

describe('tiles', () => {
	it('only exist in mercator', () => {
		const v = fitViewport({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, 'equirectangular', {
			width: 100,
			height: 100
		});
		expect(tilesFor(v)).toEqual([]);
	});
	it('covers a city-sized extent', () => {
		const v = fitViewport({ minX: 2.2, minY: 48.8, maxX: 2.5, maxY: 48.9 }, 'mercator', {
			width: 800,
			height: 500
		});
		const tiles = tilesFor(v);
		expect(tiles.length).toBeGreaterThan(0);
		expect(tiles.length).toBeLessThanOrEqual(36);
		expect(tiles[0].z).toBe(tileZoom(v.scale));
		expect(tileUrl({ z: 3, x: 4, y: 5 })).toBe('https://tile.openstreetmap.org/3/4/5.png');
	});
});
