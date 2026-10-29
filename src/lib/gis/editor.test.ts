import { describe, expect, it } from 'vitest';
import { buildWkt, emptyParts, fromWkt } from './editor.ts';

const part = (...xy: [string, string][]) => xy.map(([x, y]) => ({ x, y }));

describe('buildWkt', () => {
	it('builds a point', () => {
		expect(buildWkt('Point', [part(['1', '2.5'])])).toEqual({ ok: true, wkt: 'POINT(1 2.5)' });
	});
	it('rejects an incomplete or non-numeric point', () => {
		expect(buildWkt('Point', emptyParts('Point')).ok).toBe(false);
		expect(buildWkt('Point', [part(['a', '2'])]).ok).toBe(false);
	});
	it('builds lines and multipoints', () => {
		expect(buildWkt('LineString', [part(['0', '0'], ['1', '1'])])).toEqual({
			ok: true,
			wkt: 'LINESTRING(0 0,1 1)'
		});
		expect(buildWkt('LineString', [part(['0', '0'])]).ok).toBe(false);
		expect(buildWkt('MultiPoint', [part(['0', '0'], ['1', '1'])])).toEqual({
			ok: true,
			wkt: 'MULTIPOINT((0 0),(1 1))'
		});
	});
	it('builds polygons and checks the rings are closed', () => {
		const ring = part(['0', '0'], ['1', '0'], ['1', '1'], ['0', '0']);
		expect(buildWkt('Polygon', [ring])).toEqual({ ok: true, wkt: 'POLYGON((0 0,1 0,1 1,0 0))' });
		const open = part(['0', '0'], ['1', '0'], ['1', '1'], ['0', '1']);
		expect(buildWkt('Polygon', [open]).ok).toBe(false);
	});
	it('validates text types', () => {
		expect(buildWkt('MultiPolygon', [], 'MULTIPOLYGON(((0 0,1 0,1 1,0 0)))').ok).toBe(true);
		expect(buildWkt('MultiPolygon', [], 'POINT(1 2)').ok).toBe(false);
		expect(buildWkt('GeometryCollection', [], 'nope').ok).toBe(false);
	});
});

describe('fromWkt', () => {
	it('loads each shape of editor', () => {
		expect(fromWkt('POINT(1 2)')).toEqual({ type: 'Point', parts: [part(['1', '2'])], text: '' });
		expect(fromWkt('POLYGON((0 0,1 0,1 1,0 0))').parts).toHaveLength(1);
		expect(fromWkt('MULTILINESTRING((0 0,1 1),(2 2,3 3))').parts).toHaveLength(2);
		expect(fromWkt('GEOMETRYCOLLECTION(POINT(1 2))').text).toBe('GEOMETRYCOLLECTION(POINT(1 2))');
	});
	it('falls back to an empty point', () => {
		expect(fromWkt('garbage').type).toBe('Point');
		expect(fromWkt('').parts).toEqual(emptyParts('Point'));
	});
});
