import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseWkt } from '#lib/gis/wkt.ts';
import { createConnection, type Connection } from '../db/connection';
import { DatabaseInterface } from '../db/dbi';
import { GisError, loadGisData } from './gis';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

for (const { name, port } of servers) {
	describe(`GIS data against ${name}`, () => {
		let conn: Connection | undefined;
		let dbi: DatabaseInterface;
		const db = `tmp_t9c_gis_${port}`;

		beforeAll(async () => {
			try {
				conn = await createConnection(
					{
						host: '127.0.0.1',
						port,
						socket: '',
						ssl: false,
						ssl_ca: null,
						ssl_cert: null,
						ssl_key: null,
						ssl_ciphers: null,
						ssl_verify: true,
						compress: false
					},
					'root',
					'root'
				);
				dbi = new DatabaseInterface(conn, { only_db: '', hide_db: '', host: '127.0.0.1', port });
				await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
				await conn.query(`CREATE DATABASE \`${db}\``);
				await conn.query(
					`CREATE TABLE \`${db}\`.shapes (id int PRIMARY KEY, name varchar(20), g geometry)`
				);
				await conn.query(
					`INSERT INTO \`${db}\`.shapes VALUES
					(1,'a',ST_GeomFromText('POINT(1 2)')),
					(2,'b',ST_GeomFromText('POINT(3 4)')),
					(3,'c',ST_GeomFromText('POLYGON((0 0,5 0,5 5,0 0))')),
					(4,'none',NULL)`
				);
			} catch {
				conn = undefined;
				console.warn(`[integration] ${name} unreachable on 127.0.0.1:${port}, skipping`);
			}
		});
		afterAll(async () => {
			await conn?.query(`DROP DATABASE IF EXISTS \`${db}\``);
			await conn?.end();
		});

		it('returns WKT, SRID and label values', async (c) => {
			if (!conn) return c.skip();
			const d = await loadGisData(dbi, db, 'shapes', { sql: null, labelColumn: 'name' });
			expect(d.spatialColumns).toEqual(['g']);
			expect(d.geometryColumn).toBe('g');
			expect(d.total).toBe(3);
			expect(d.rows.map((r) => r.label).sort()).toEqual(['a', 'b', 'c']);
			expect(d.rows.map((r) => parseWkt(r.wkt).type).sort()).toEqual(['Point', 'Point', 'Polygon']);
			expect(d.rows[0].srid).toBe(0);
			expect(d.rows[0].values.id).toBeDefined();
		});

		it('paginates and accepts a custom SELECT', async (c) => {
			if (!conn) return c.skip();
			const d = await loadGisData(dbi, db, 'shapes', {
				sql: `SELECT id, name, g FROM shapes WHERE id > 1;`,
				limit: 1,
				offset: 1
			});
			expect(d.rows).toHaveLength(1);
			expect(d.total).toBe(2);
		});

		it('keeps x/y order for SRID 4326', async (c) => {
			if (!conn) return c.skip();
			await conn.query(`CREATE TABLE \`${db}\`.geo (id int PRIMARY KEY, g geometry)`);
			try {
				await conn.query(
					`INSERT INTO \`${db}\`.geo VALUES (1, ST_GeomFromText('POINT(2.35 48.85)', 4326, 'axis-order=long-lat'))`
				);
			} catch {
				// MariaDB has no axis-order option: x is the longitude
				await conn.query(
					`INSERT INTO \`${db}\`.geo VALUES (1, ST_GeomFromText('POINT(2.35 48.85)', 4326))`
				);
			}
			const d = await loadGisData(dbi, db, 'geo', { sql: null });
			expect(d.rows[0].srid).toBe(4326);
			expect(d.rows[0].wkt).toBe('POINT(2.35 48.85)');
		});

		it('rejects anything but a single SELECT', async (c) => {
			if (!conn) return c.skip();
			await expect(
				loadGisData(dbi, db, 'shapes', { sql: 'DELETE FROM shapes' })
			).rejects.toBeInstanceOf(GisError);
			await expect(
				loadGisData(dbi, db, 'shapes', { sql: 'SELECT 1; SELECT 2' })
			).rejects.toBeInstanceOf(GisError);
		});

		it('reads the type_zoo geometry column of the fixture', async (c) => {
			if (!conn) return c.skip();
			const d = await loadGisData(dbi, 'sma_test', 'type_zoo', { sql: null });
			expect(d.spatialColumns).toContain('c_geometry');
			expect(d.rows.length).toBeGreaterThanOrEqual(1);
			expect(() => parseWkt(d.rows[0].wkt)).not.toThrow();
		});
	});
}
