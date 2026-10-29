import { expect, test } from '@playwright/test';
import { createConnection, type Connection } from 'mysql2/promise';
import { gotoReady, login } from './helpers.ts';

const DB = 'tmp_t8a_e2e';
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

/** Drop the database and every pmadb row that mentions it (the lists are shared with other specs). */
async function cleanup() {
	const c = await connect();
	try {
		await c.query(`DROP DATABASE IF EXISTS \`${DB}\``);
		await c.query('DELETE FROM `phpmyadmin`.`pma__navigationhiding` WHERE `db_name` = ?', [DB]);
		for (const table of ['pma__recent', 'pma__favorite']) {
			const [rows] = await c.query(`SELECT username, \`tables\` FROM \`phpmyadmin\`.\`${table}\``);
			for (const r of rows as { username: string; tables: string }[]) {
				const list = (JSON.parse(r.tables) as { db: string }[]).filter((t) => t.db !== DB);
				await c.query(`REPLACE INTO \`phpmyadmin\`.\`${table}\` VALUES (?, ?)`, [
					r.username,
					JSON.stringify(list)
				]);
			}
		}
	} finally {
		await c.end();
	}
}

async function stored(table: string): Promise<{ db: string; table: string }[]> {
	const c = await connect();
	try {
		const [rows] = await c.query(
			`SELECT \`tables\` FROM \`phpmyadmin\`.\`${table}\` WHERE username = 'root'`
		);
		const row = (rows as { tables: string }[])[0];
		return row ? JSON.parse(row.tables) : [];
	} finally {
		await c.end();
	}
}

test.beforeAll(async () => {
	try {
		await cleanup();
		const c = await connect();
		await c.query(`CREATE DATABASE \`${DB}\``);
		await c.query(`CREATE TABLE \`${DB}\`.fav_one (id INT PRIMARY KEY)`);
		await c.query(`CREATE TABLE \`${DB}\`.fav_two (id INT PRIMARY KEY)`);
		await c.end();
		dbUp = true;
	} catch {
		dbUp = false;
	}
});
test.afterAll(async () => {
	if (dbUp) await cleanup();
});
test.beforeEach(async ({ page }) => {
	test.skip(!dbUp, 'MySQL fixture on 127.0.0.1:33306 unreachable (run pnpm db:up)');
	await login(page);
});

test('configuration storage page lists every feature as OK on the fixture', async ({ page }) => {
	const main = page.getByRole('main');
	await gotoReady(page, '/server/check-relations');
	await expect(main.getByRole('heading', { name: 'Configuration storage' })).toBeVisible();
	await expect(main.getByTestId('storage-summary')).toHaveText('All features work');
	const rows = main.getByTestId('storage-table').getByRole('row');
	// header + 19 features
	await expect(rows).toHaveCount(20);
	await expect(main.getByTestId('storage-table').getByText('not OK')).toHaveCount(0);
	await expect(main.getByTestId('feature-navigationhiding')).toContainText('OK');
	// nothing to create, so no create actions
	await expect(main.getByTestId('create-storage')).toHaveCount(0);

	// the home page has no warning when everything is configured
	await gotoReady(page, '/');
	await expect(page.getByRole('main').getByTestId('storage-warning')).toHaveCount(0);
});

test('visited tables show up under Recent and starred tables under Favorites', async ({ page }) => {
	const main = page.getByRole('main');
	await gotoReady(page, `/db/${DB}/table/fav_one/browse`);
	await expect(main.getByTestId('favorite-fav_one')).toBeVisible();
	await gotoReady(page, `/db/${DB}/table/fav_two/browse`);

	const recent = page.getByTestId('nav-recent');
	await recent.getByRole('button', { name: /Recent/ }).click();
	await expect(recent.getByRole('link', { name: `${DB}.fav_two` })).toBeVisible();
	await expect(recent.getByRole('link', { name: `${DB}.fav_one` })).toBeVisible();
	// stored like phpMyAdmin does: newest first, JSON of {db, table}. Other specs log in as root and
	// visit tables too, so only look at our own entries.
	const list = (await stored('pma__recent')).filter((t) => t.db === DB);
	expect(list).toEqual([
		{ db: DB, table: 'fav_two' },
		{ db: DB, table: 'fav_one' }
	]);

	// star from the table page header
	const star = main.getByRole('button', { name: `Add fav_two to favorites` });
	await star.click();
	await expect(main.getByRole('button', { name: 'Remove fav_two from favorites' })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	const favorites = page.getByTestId('nav-favorites');
	await favorites.getByRole('button', { name: /Favorites/ }).click();
	await expect(favorites.getByRole('link', { name: `${DB}.fav_two` })).toBeVisible();
	expect((await stored('pma__favorite')).filter((t) => t.db === DB)).toEqual([
		{ db: DB, table: 'fav_two' }
	]);

	// star from the database structure row; unstar from the table page again
	await gotoReady(page, `/db/${DB}/structure`);
	await favorites.getByRole('button', { name: /Favorites/ }).click();
	await main.getByTestId('favorite-fav_one').click();
	await expect(favorites.getByRole('link', { name: `${DB}.fav_one` })).toBeVisible();
	await main.getByTestId('favorite-fav_one').click();
	await expect(favorites.getByRole('link', { name: `${DB}.fav_one` })).toHaveCount(0);
	await main.getByTestId('favorite-fav_two').click();
	await expect(favorites.getByRole('link', { name: `${DB}.fav_two` })).toHaveCount(0);
	expect((await stored('pma__favorite')).filter((t) => t.db === DB)).toEqual([]);
});

test('a table can be hidden in the navigation tree and unhidden again', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/structure`);
	const node = page.getByTestId('nav-db-' + DB);
	const tables = node.getByTestId('nav-group-tables');
	await expect(tables.getByRole('link', { name: 'fav_two', exact: true })).toBeVisible();

	// hover the start of the row: the quick-access and hide buttons appear at its end
	await tables
		.getByRole('link', { name: 'fav_two', exact: true })
		.hover({ position: { x: 4, y: 4 } });
	await tables.getByRole('button', { name: 'Hide fav_two' }).click();
	await expect(tables.getByRole('link', { name: 'fav_two', exact: true })).toHaveCount(0);
	await expect(tables.getByRole('link', { name: 'fav_one', exact: true })).toBeVisible();

	// filtered out of the data: still hidden after a full reload, and gone from the command palette
	await gotoReady(page, `/db/${DB}/structure`);
	await expect(
		page.getByTestId('nav-db-' + DB).getByRole('link', { name: 'fav_two', exact: true })
	).toHaveCount(0);
	await page.keyboard.press('Control+k');
	await page.getByPlaceholder('Jump to a database, table or page...').fill('fav_two');
	await expect(page.getByRole('option', { name: /fav_two/ })).toHaveCount(0);
	await page.keyboard.press('Escape');

	// the "Show hidden items" dialog unhides it
	await page.getByTestId('show-hidden-' + DB).click();
	const dialog = page.getByTestId('hidden-items-dialog');
	await expect(dialog.getByText('fav_two')).toBeVisible();
	await dialog.getByRole('button', { name: 'Unhide fav_two' }).click();
	await expect(dialog).toBeHidden();
	await expect(
		page
			.getByTestId('nav-db-' + DB)
			.getByTestId('nav-group-tables')
			.getByRole('link', { name: 'fav_two', exact: true })
	).toBeVisible();
	await expect(page.getByTestId('show-hidden-' + DB)).toHaveCount(0);
});
