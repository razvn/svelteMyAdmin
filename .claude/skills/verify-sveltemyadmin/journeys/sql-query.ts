// Journey for features/sql-query.md: run a SELECT, a write and a broken statement from the
// table SQL page, then confirm the write in MySQL directly.
import { expect, gotoReady, journey, login, tmpDb, withRoot } from '../lib.ts';

const DB = tmpDb('sql');

await journey('sql-query', async ({ page, step, proof, save }) => {
	step(`precondition: create ${DB}.books with 3 rows (direct SQL, not the feature under test)`);
	await withRoot(async (c) => {
		await c.query(`DROP DATABASE IF EXISTS \`${DB}\``);
		await c.query(`CREATE DATABASE \`${DB}\``);
		await c.query(`CREATE TABLE \`${DB}\`.books (id int PRIMARY KEY, title varchar(60) NOT NULL)`);
		await c.query(`INSERT INTO \`${DB}\`.books VALUES (1, 'alpha'), (2, 'beta'), (3, 'gamma')`);
	});
	try {
		const main = page.getByRole('main');
		const editor = main.getByRole('textbox', { name: 'SQL query' });
		const go = main.getByRole('button', { name: 'Go', exact: true });

		step('log in as root on server 1 (MySQL 8.4) -> home shows root@127.0.0.1:33306');
		await login(page);
		await expect(page.getByTestId('connection-info')).toContainText('root@127.0.0.1:33306');

		step(
			`open /db/${DB}/table/books/sql -> editor is prefilled with SELECT * FROM \`books\` WHERE 1`
		);
		await gotoReady(page, `/db/${DB}/table/books/sql`);
		await expect(editor).toContainText('SELECT * FROM `books` WHERE 1');

		step("run SELECT * FROM books WHERE id >= 2 -> grid shows 'beta' and 'gamma', 2 total");
		await editor.fill('SELECT * FROM books WHERE id >= 2');
		await go.click();
		await expect(page.getByTestId('statement-message')).toContainText('(2 total');
		await expect(main.getByRole('cell', { name: 'beta', exact: true })).toBeVisible();
		await expect(main.getByRole('cell', { name: 'gamma', exact: true })).toBeVisible();
		await expect(main.getByRole('cell', { name: 'alpha', exact: true })).toHaveCount(0);
		await proof('select-result');

		step("run INSERT INTO books VALUES (4, 'delta') -> '1 row affected.'");
		await editor.fill("INSERT INTO books VALUES (4, 'delta')");
		await go.click();
		await expect(page.getByTestId('statement-message')).toContainText('1 row affected.');
		await proof('insert-result');

		step('side effect: MySQL now has row 4 = delta (read directly)');
		const [rows] = await withRoot((c) =>
			c.query(`SELECT id, title FROM \`${DB}\`.books ORDER BY id`)
		);
		save('books-after-insert.json', JSON.stringify(rows, null, 2));
		expect(rows).toEqual([
			{ id: 1, title: 'alpha' },
			{ id: 2, title: 'beta' },
			{ id: 3, title: 'gamma' },
			{ id: 4, title: 'delta' }
		]);

		step('run SELEC 1 -> inline error #1064, no crash');
		await editor.fill('SELEC 1');
		await go.click();
		await expect(page.getByTestId('statement-error')).toContainText('#1064');
		await proof('syntax-error');
	} finally {
		step(`cleanup: drop ${DB}`);
		await withRoot((c) => c.query(`DROP DATABASE IF EXISTS \`${DB}\``));
	}
});
