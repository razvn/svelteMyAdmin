import { expect, test } from '@playwright/test';
import { createConnection, type Connection } from 'mysql2/promise';
import { gotoReady, login } from './helpers.ts';

const DB = 'tmp_t8c_e2e';
// 1x1 PNG
const PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
	'base64'
);
let dbUp = false;

async function connect(): Promise<Connection> {
	return createConnection({
		host: '127.0.0.1',
		port: 33306,
		user: 'root',
		password: 'root',
		connectTimeout: 2000
	});
}

async function reset(create: boolean) {
	const c = await connect();
	await c.query(`DROP DATABASE IF EXISTS \`${DB}\``);
	await c.query('DELETE FROM `phpmyadmin`.`pma__column_info` WHERE db_name = ?', [DB]);
	if (create) {
		await c.query(`CREATE DATABASE \`${DB}\``);
		await c.query(
			`CREATE TABLE \`${DB}\`.tx (id INT PRIMARY KEY AUTO_INCREMENT, created DATETIME, flag TINYINT, img BLOB, ip INT UNSIGNED)`
		);
		await c.query(
			`INSERT INTO \`${DB}\`.tx (created, flag, img) VALUES ('2024-05-03 10:20:30', 1, ?)`,
			[PNG]
		);
		await c.query(`INSERT INTO \`${DB}\`.tx (created, flag) VALUES ('2024-05-04 08:00:00', 0)`);
	}
	await c.end();
}

test.beforeAll(async () => {
	try {
		await reset(true);
		dbUp = true;
	} catch {
		dbUp = false;
	}
});
test.afterAll(async () => {
	if (dbUp) await reset(false);
});
test.beforeEach(async ({ page }) => {
	test.skip(!dbUp, 'MySQL fixture on 127.0.0.1:33306 unreachable (run pnpm db:up)');
	await login(page);
});

test.describe.configure({ mode: 'serial' });

const tx = `/db/${DB}/table/tx`;

test('the overview lists media types and transformations', async ({ page }) => {
	await gotoReady(page, '/transformations');
	const main = page.getByRole('main');
	await expect(main.getByTestId('mime-types')).toContainText('Image/JPEG');
	const out = main.getByTestId('transformation-table');
	await expect(out).toContainText('Text/Plain: Dateformat');
	await expect(out).toContainText('Text/Plain: External');
	await expect(main.getByTestId('input_transformation-table')).toContainText(
		'Text/Plain: Iptolong'
	);
});

test('configure transformations through change column', async ({ page }) => {
	await gotoReady(page, `${tx}/structure/change?field=created&field=flag&field=img&field=ip`);
	const main = page.getByRole('main');
	await main
		.getByLabel('Browser display transformation of column 1', { exact: true })
		.selectOption('output/text_plain_dateformat.php');
	await main
		.getByLabel('Browser display transformation of column 2', { exact: true })
		.selectOption('output/text_plain_bool2text.php');
	await main.getByLabel('Browser display transformation options of column 2').fill("'yes','no'");
	await main.getByLabel('Media type of column 3').selectOption('image_png');
	await main
		.getByLabel('Browser display transformation of column 3', { exact: true })
		.selectOption('output/image_png_inline.php');
	await main.getByLabel('Browser display transformation options of column 3').fill('60,60');
	await main
		.getByLabel('Input transformation of column 4', { exact: true })
		.selectOption('input/text_plain_iptolong.php');
	await main.getByRole('button', { name: 'Save' }).click();
	await expect(page).toHaveURL(/\/structure$/);

	// stored in phpMyAdmin's format
	const c = await connect();
	const [rows] = await c.query(
		'SELECT column_name, mimetype, transformation, transformation_options, input_transformation FROM `phpmyadmin`.`pma__column_info` WHERE db_name = ? ORDER BY column_name',
		[DB]
	);
	await c.end();
	expect(rows).toMatchObject([
		{ column_name: 'created', transformation: 'output/text_plain_dateformat.php' },
		{
			column_name: 'flag',
			transformation: 'output/text_plain_bool2text.php',
			transformation_options: "'yes','no'"
		},
		{ column_name: 'img', mimetype: 'image_png', transformation: 'output/image_png_inline.php' },
		{ column_name: 'ip', input_transformation: 'input/text_plain_iptolong.php' }
	]);

	// the change form shows them again
	await gotoReady(page, `${tx}/structure/change?field=flag`);
	await expect(
		page.getByRole('main').getByLabel('Browser display transformation options of column 1')
	).toHaveValue("'yes','no'");
});

test('browse shows transformed values, an inline image and a raw toggle', async ({ page }) => {
	await gotoReady(page, `${tx}/browse`);
	const main = page.getByRole('main');
	const first = main.getByRole('row').filter({ hasText: 'May 03, 2024 at 10:20 AM' });
	await expect(first).toHaveCount(1);
	await expect(first.locator('td[data-column="flag"]')).toHaveText('yes');
	await expect(main.getByRole('row').filter({ hasText: 'May 04, 2024 at 08:00 AM' })).toContainText(
		'no'
	);

	const img = first.locator('td[data-column="img"] img');
	await expect(img).toBeVisible();
	const src = await img.getAttribute('src');
	expect(src).toContain('/transformation/wrapper?');
	await expect
		.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth))
		.toBe(1);
	const res = await page.request.get(src!);
	expect(res.headers()['content-type']).toBe('image/png');
	expect((await res.body()).equals(PNG)).toBe(true);

	await main.getByTestId('toggle-raw').click();
	await expect(main.getByRole('row').filter({ hasText: '2024-05-03 10:20:30' })).toHaveCount(1);
	await expect(main.locator('td[data-column="img"] img')).toHaveCount(0);
	await main.getByTestId('toggle-raw').click();
	await expect(main.locator('td[data-column="img"] img')).toHaveCount(1);
});

test('SQL results apply the transformations', async ({ page }) => {
	await gotoReady(
		page,
		`${tx}/sql?sql_query=${encodeURIComponent(`SELECT id, created, flag FROM \`${DB}\`.tx ORDER BY id`)}`
	);
	const main = page.getByRole('main');
	await main.getByRole('button', { name: /^Go$/ }).click();
	const result = main.getByTestId('statement-result');
	await expect(result).toContainText('May 03, 2024 at 10:20 AM');
	await expect(result.locator('td[data-column="flag"]').first()).toHaveText('yes');
});

test('the Iptolong input transformation stores an integer', async ({ page }) => {
	await gotoReady(page, `${tx}/insert`);
	const row = page.getByTestId('insert-row-0');
	await row.getByRole('checkbox', { name: 'Null ip' }).click();
	await row.getByLabel('Value of ip').fill('10.0.0.5');
	await page.getByRole('button', { name: 'Go', exact: true }).click();
	// "After saving: go back" (the default) leaves the Insert page, so the result alert is transient.
	await expect(page).toHaveURL(/\/browse/);
	const c = await connect();
	const [rows] = await c.query(`SELECT ip FROM \`${DB}\`.tx WHERE ip IS NOT NULL`);
	await c.end();
	expect(rows).toEqual([{ ip: 167772165 }]);

	// editing shows the dotted quad again
	await gotoReady(page, `${tx}/browse`);
	await page.getByRole('main').getByRole('link', { name: 'Edit row 3' }).click();
	await expect(page.getByTestId('insert-row-0').getByLabel('Value of ip')).toHaveValue('10.0.0.5');
});
