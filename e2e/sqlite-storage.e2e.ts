import { existsSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { DatabaseSync } from 'node:sqlite';
import { gotoReady } from './helpers.ts';

// Server 2 of config.sample.json (MariaDB, port 33307) has no pmadb: it keeps its configuration
// storage in the SQLite file of `ConfigStorage` (./var/storage.sqlite). A dedicated MariaDB user keeps
// the preferences, favourites... away from the other (parallel) specs that log in as root.
const USER = 'tmp_t11_u';
const PASSWORD = 'T11-Pass-1!';
const DB = 'tmp_t11_e2e';
const STORAGE = 'var/storage.sqlite';

async function withRoot<T>(fn: (c: Awaited<ReturnType<typeof createConnection>>) => Promise<T>) {
	const c = await createConnection({
		host: '127.0.0.1',
		port: 33307,
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

/** Read (or clean) the SQLite file from the test process: the app writes it from its own process. */
function sqlite<T>(fn: (db: DatabaseSync) => T): T | undefined {
	if (!existsSync(STORAGE)) return undefined;
	const db = new DatabaseSync(STORAGE);
	try {
		db.exec('PRAGMA busy_timeout = 5000');
		return fn(db);
	} finally {
		db.close();
	}
}

function cleanupStorage() {
	sqlite((db) => {
		db.prepare('DELETE FROM pma__bookmark WHERE "user" = ? OR dbase = ?').run(USER, DB);
		db.prepare('DELETE FROM pma__favorite WHERE username = ?').run(USER);
		db.prepare('DELETE FROM pma__recent WHERE username = ?').run(USER);
		db.prepare('DELETE FROM pma__userconfig WHERE username = ?').run(USER);
		db.prepare('DELETE FROM pma__history WHERE username = ?').run(USER);
		db.prepare('DELETE FROM pma__relation WHERE master_db = ?').run(DB);
		db.prepare(
			'DELETE FROM pma__table_coords WHERE pdf_page_number IN (SELECT page_nr FROM pma__pdf_pages WHERE db_name = ?)'
		).run(DB);
		db.prepare('DELETE FROM pma__pdf_pages WHERE db_name = ?').run(DB);
	});
}

async function cleanup() {
	await withRoot(async (c) => {
		await c.query(`DROP USER IF EXISTS '${USER}'@'%'`);
		await c.query(`DROP DATABASE IF EXISTS \`${DB}\``);
	});
	cleanupStorage();
}

let dbUp = false;
test.beforeAll(async () => {
	try {
		await cleanup();
		await withRoot(async (c) => {
			await c.query(`CREATE USER '${USER}'@'%' IDENTIFIED BY '${PASSWORD}'`);
			await c.query(`CREATE DATABASE \`${DB}\``);
			await c.query(
				`CREATE TABLE \`${DB}\`.authors (id INT NOT NULL PRIMARY KEY, name VARCHAR(40))`
			);
			await c.query(
				`CREATE TABLE \`${DB}\`.books (id INT NOT NULL PRIMARY KEY, author_id INT, title VARCHAR(40))`
			);
			await c.query(`GRANT ALL ON \`${DB}\`.* TO '${USER}'@'%'`);
		});
		dbUp = true;
	} catch {
		dbUp = false;
	}
});
test.afterAll(async () => {
	if (dbUp) await cleanup();
});

const main = (page: Page) => page.getByRole('main');

async function loginMaria(page: Page) {
	await gotoReady(page, '/login?server=2');
	await page.getByLabel('Username').fill(USER);
	await page.getByLabel('Password').fill(PASSWORD);
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
}

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
	test.skip(!dbUp, 'MariaDB fixture on 127.0.0.1:33307 unreachable (run pnpm db:up)');
	await loginMaria(page);
});

test('the storage page reports the SQLite file and every feature OK', async ({ page }) => {
	await gotoReady(page, '/server/check-relations');
	await expect(main(page).getByTestId('storage-sqlite')).toContainText(STORAGE);
	await expect(main(page).getByTestId('storage-summary')).toHaveText('All features work');
	await expect(main(page).getByTestId('storage-table').getByRole('row')).toHaveCount(20);
	// nothing to create by hand
	await expect(main(page).getByTestId('create-storage')).toHaveCount(0);
	await expect(main(page).getByTestId('create-in-db')).toHaveCount(0);

	await gotoReady(page, '/');
	await expect(main(page).getByTestId('storage-warning')).toHaveCount(0);
});

test('a SQL bookmark is saved in the SQLite file and reused after a reload', async ({ page }) => {
	const label = `t11-bookmark-${Date.now()}`;
	const sqlUrl = `/db/${DB}/sql`;
	const editor = main(page).getByRole('textbox', { name: 'SQL query' });
	await gotoReady(page, sqlUrl);
	await editor.fill("SELECT 'bookmarked_t11' AS marker");

	const extras = page.getByTestId('sql-extras');
	await extras.getByRole('tab', { name: 'Bookmark this SQL query' }).click();
	await extras.getByLabel('Label').fill(label);
	await extras.getByTestId('bookmark-form').getByRole('button').click();
	const item = extras.getByTestId('bookmark-item').filter({ hasText: label });
	await expect(item).toHaveCount(1);

	const stored = sqlite((db) =>
		db
			.prepare('SELECT query, server FROM pma__bookmark WHERE label = ? AND "user" IN (?, \'\')')
			.all(label, USER)
	);
	expect(stored).toHaveLength(1);
	expect(stored?.[0]).toMatchObject({
		query: "SELECT 'bookmarked_t11' AS marker",
		server: '127.0.0.1:33307'
	});

	// a fresh page load still lists it, and running it executes the stored query
	await gotoReady(page, sqlUrl);
	await page.getByTestId('sql-extras').getByRole('tab', { name: 'Bookmarks' }).click();
	const again = page
		.getByTestId('sql-extras')
		.getByTestId('bookmark-item')
		.filter({ hasText: label });
	await expect(again).toHaveCount(1);
	await again.getByRole('button', { name: `Run bookmark ${label}` }).click();
	await expect(page.getByTestId('statement-sql')).toContainText('bookmarked_t11');

	await page.getByTestId('sql-extras').getByRole('tab', { name: 'Bookmarks' }).click();
	await again.getByRole('button', { name: `Delete bookmark ${label}` }).click();
	await expect(
		page.getByTestId('sql-extras').getByTestId('bookmark-item').filter({ hasText: label })
	).toHaveCount(0);
	expect(
		sqlite((db) => db.prepare('SELECT 1 FROM pma__bookmark WHERE label = ?').all(label))
	).toHaveLength(0);
});

test('a favourite table survives a reload and lives in the SQLite file', async ({ page }) => {
	await gotoReady(page, `/db/${DB}/table/authors/browse`);
	await main(page).getByRole('button', { name: 'Add authors to favorites' }).click();
	await expect(
		main(page).getByRole('button', { name: 'Remove authors from favorites' })
	).toHaveAttribute('aria-pressed', 'true');

	await gotoReady(page, `/db/${DB}/structure`);
	const favorites = page.getByTestId('nav-favorites');
	await favorites.getByRole('button', { name: /Favorites/ }).click();
	await expect(favorites.getByRole('link', { name: `${DB}.authors` })).toBeVisible();

	const row = sqlite((db) =>
		db.prepare('SELECT "tables" AS tables FROM pma__favorite WHERE username = ?').get(USER)
	) as { tables: string } | undefined;
	expect(JSON.parse(row!.tables)).toEqual([{ db: DB, table: 'authors' }]);

	await main(page).getByTestId('favorite-authors').click();
	await expect(favorites.getByRole('link', { name: `${DB}.authors` })).toHaveCount(0);
});

test('a user preference persists across logout and login', async ({ page }) => {
	await gotoReady(page, '/server/settings/main');
	await main(page).getByTestId('field-MaxRows').locator('input').fill('17');
	await main(page).getByTestId('prefs-apply').click();
	await expect(main(page).getByTestId('settings-saved')).toBeVisible();

	const row = sqlite((db) =>
		db.prepare('SELECT config_data FROM pma__userconfig WHERE username = ?').get(USER)
	) as { config_data: string } | undefined;
	expect(JSON.parse(row!.config_data)).toMatchObject({ MaxRows: 17 });

	await page.getByRole('button', { name: 'User menu' }).click();
	await page.getByRole('menuitem', { name: 'Log out' }).click();
	await expect(page).toHaveURL(/\/login/);
	await page.context().clearCookies();

	await loginMaria(page);
	await gotoReady(page, '/server/settings/main');
	await expect(main(page).getByTestId('field-MaxRows').locator('input')).toHaveValue('17');
	await gotoReady(page, '/server/settings');
	await expect(main(page).getByTestId('settings-count')).toContainText('1 customised setting');
	// not the cookie fallback
	expect((await page.context().cookies()).some((c) => c.name === 'sma_userprefs')).toBe(false);

	await main(page).getByTestId('reset-all').click();
	await page.getByTestId('reset-confirm').click();
	await expect(main(page).getByTestId('settings-count')).toContainText('0 customised settings');
});

test('an internal relation and a designer page are stored in the SQLite file', async ({ page }) => {
	// internal relation books.author_id -> authors.id (Table > Relation view)
	await gotoReady(page, `/db/${DB}/table/books/relation`);
	const card = main(page).getByTestId('internal-card');
	const pick = async (label: string, option: string) => {
		await card.getByRole('combobox', { name: label }).click();
		await page.getByRole('option', { name: option, exact: true }).click();
	};
	await pick('Internal relation column', 'author_id');
	await pick('Internal relation database', DB);
	await pick('Internal relation table', 'authors');
	await pick('Internal relation referenced column', 'id');
	await card.getByRole('button', { name: 'Save relation' }).click();
	await expect(card.getByText(`${DB}.authors.id`)).toBeVisible();
	expect(
		sqlite((db) =>
			db
				.prepare('SELECT foreign_table, foreign_field FROM pma__relation WHERE master_db = ?')
				.all(DB)
		)
	).toEqual([{ foreign_table: 'authors', foreign_field: 'id' }]);

	// the designer draws it and keeps a page
	await gotoReady(page, `/db/${DB}/designer`);
	await expect(
		main(page).locator('[data-testid="designer-relation"][data-from="books.author_id"]')
	).toHaveCount(1);
	await main(page).getByRole('button', { name: 'New page' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByPlaceholder('Page name').fill('tmp_t11_page');
	await dialog.getByRole('button', { name: 'Save' }).click();
	await expect(page).toHaveURL(/designer\?page=\d+/);
	await expect(main(page).getByTestId('designer-page-select')).toContainText('tmp_t11_page');
	const coords = sqlite((db) =>
		db
			.prepare(
				'SELECT co.table_name FROM pma__table_coords co JOIN pma__pdf_pages p ON p.page_nr = co.pdf_page_number WHERE p.db_name = ? AND p.page_descr = ? ORDER BY co.table_name'
			)
			.all(DB, 'tmp_t11_page')
	);
	expect(coords).toEqual([{ table_name: 'authors' }, { table_name: 'books' }]);

	await reloadSelect(page);
	await main(page).getByTestId('designer-table-books').waitFor();

	// remove the relation again
	await gotoReady(page, `/db/${DB}/table/books/relation`);
	await main(page).getByRole('button', { name: 'Remove internal relation of author_id' }).click();
	await expect(main(page).getByTestId('internal-card').getByText(`${DB}.authors.id`)).toHaveCount(
		0
	);
});

async function reloadSelect(page: Page) {
	await page.reload();
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
	await expect(main(page).getByTestId('designer-page-select')).toContainText('tmp_t11_page');
}

test('nothing was written to a MariaDB pmadb: the server does not use one', async () => {
	// The docker fixture also creates a `phpmyadmin` database on MariaDB, but this server has no
	// `pmadb` configured, so the app must never touch it.
	const leaked = await withRoot(async (c) => {
		const [dbs] = await c.query("SHOW DATABASES LIKE 'phpmyadmin'");
		if ((dbs as unknown[]).length === 0) return 0;
		let n = 0;
		for (const [table, column, value] of [
			['pma__userconfig', 'username', USER],
			['pma__favorite', 'username', USER],
			['pma__recent', 'username', USER],
			['pma__history', 'username', USER],
			['pma__bookmark', 'dbase', DB],
			['pma__relation', 'master_db', DB],
			['pma__pdf_pages', 'db_name', DB]
		]) {
			const [rows] = await c.query(
				`SELECT 1 FROM \`phpmyadmin\`.\`${table}\` WHERE \`${column}\` = ?`,
				[value]
			);
			n += (rows as unknown[]).length;
		}
		return n;
	});
	expect(leaked).toBe(0);
});
