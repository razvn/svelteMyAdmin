import { expect, test } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { gotoReady, login } from './helpers.ts';

const DB = 'tmp_t9c_gis_e2e';
let dbUp = false;

async function withRoot<T>(fn: (c: Awaited<ReturnType<typeof createConnection>>) => Promise<T>) {
	const c = await createConnection({
		host: '127.0.0.1',
		port: 33306,
		user: 'root',
		password: 'root',
		connectTimeout: 2000
	});
	try {
		return await fn(c);
	} finally {
		await c.end();
	}
}

test.beforeAll(async () => {
	try {
		await withRoot(async (c) => {
			await c.query(`DROP DATABASE IF EXISTS \`${DB}\``);
			await c.query(`CREATE DATABASE \`${DB}\``);
			await c.query(
				`CREATE TABLE \`${DB}\`.\`shapes\` (id int NOT NULL PRIMARY KEY, name varchar(20) NOT NULL, g geometry NULL)`
			);
			await c.query(
				`INSERT INTO \`${DB}\`.\`shapes\` VALUES
				(1,'alpha',ST_GeomFromText('POINT(1 1)')),
				(2,'beta',ST_GeomFromText('POINT(4 2)')),
				(3,'gamma',ST_GeomFromText('POINT(2 5)')),
				(4,'delta',ST_GeomFromText('POLYGON((0 0,6 0,6 3,0 0))'))`
			);
		});
		dbUp = true;
	} catch {
		dbUp = false;
	}
});

test.afterAll(async () => {
	if (dbUp) await withRoot((c) => c.query(`DROP DATABASE IF EXISTS \`${DB}\``));
});

test.beforeEach(async ({ page }) => {
	test.skip(!dbUp, 'MySQL fixture on 127.0.0.1:33306 unreachable (run pnpm db:up)');
	await login(page);
});

test('visualizes 3 points and 1 polygon with labels and tooltips', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/table/shapes/gis?label=name`);
	const main = page.getByRole('main');
	const map = main.getByTestId('gis-map');
	await expect(map.getByTestId('gis-shape')).toHaveCount(4);
	await expect(map.locator('svg[role=img] circle')).toHaveCount(3);
	await expect(map.locator('svg[role=img] path')).toHaveCount(1);
	await expect(map.getByTestId('gis-label')).toHaveText(['alpha', 'beta', 'gamma', 'delta']);
	// plain cartesian (SRID 0): no tile toggle
	await expect(main.getByLabel('OpenStreetMap background')).toHaveCount(0);

	await map.getByTestId('gis-shape').first().hover();
	await expect(map.getByTestId('gis-tooltip')).toContainText('alpha');

	const before = await map.locator('svg[role=img] > g').getAttribute('transform');
	await map.getByRole('button', { name: 'Zoom in' }).click();
	expect(await map.locator('svg[role=img] > g').getAttribute('transform')).not.toBe(before);
});

test('Browse links to the visualization', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/table/shapes/browse`);
	const main = page.getByRole('main');
	await main.getByRole('link', { name: 'Visualize GIS data' }).click();
	await page.waitForURL(/\/table\/shapes\/gis/);
	await expect(page.getByRole('main').getByTestId('gis-shape')).toHaveCount(4);
});

test('the GIS data editor writes WKT into the value', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/table/shapes/insert`);
	const row = page.getByRole('main').getByTestId('insert-row-0');
	await row.getByLabel('Null g').uncheck();
	await row.getByRole('button', { name: 'GIS editor for g' }).click();
	const dialog = page.getByTestId('gis-editor');
	await dialog.getByLabel('X point 1').fill('7');
	await dialog.getByLabel('Y point 1').fill('8.5');
	await expect(dialog.getByTestId('gis-wkt')).toHaveText('POINT(7 8.5)');
	await dialog.getByTestId('gis-apply').click();
	await expect(row.getByLabel('Value of g')).toHaveValue('POINT(7 8.5)');
});

test('exports SVG, PNG and PDF', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/table/shapes/gis?label=name`);
	const main = page.getByRole('main');
	await expect(main.getByTestId('gis-shape')).toHaveCount(4);
	for (const [name, ext] of [
		['SVG', 'svg'],
		['PNG', 'png'],
		['PDF', 'pdf']
	]) {
		const download = page.waitForEvent('download');
		await main.getByRole('button', { name }).click();
		expect((await download).suggestedFilename()).toBe(`shapes-g.${ext}`);
	}
});
