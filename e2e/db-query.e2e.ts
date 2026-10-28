import { expect, test } from '@playwright/test';
import { gotoReady, login } from './helpers.ts';

const QUERY_URL = '/db/sma_test/query';

test.beforeEach(async ({ page }) => {
	await login(page);
	await gotoReady(page, QUERY_URL);
});

test('query by example over authors and books: criterion, JOIN, submit', async ({ page }) => {
	const main = page.getByRole('main');
	await main.getByRole('tab', { name: 'Query by example' }).click();
	const qbe = main.getByTestId('qbe');

	await qbe.getByLabel('Field 1', { exact: true }).selectOption('`authors`.`name`');
	await qbe.getByLabel('Show 1', { exact: true }).check();
	await qbe.getByLabel('Field 2', { exact: true }).selectOption('`books`.`title`');
	await qbe.getByLabel('Show 2', { exact: true }).check();
	await qbe.getByLabel('Field 3', { exact: true }).selectOption('`authors`.`name`');
	await qbe.getByLabel('Criteria 3', { exact: true }).fill("= 'Stanisław Lem'");

	await qbe.getByRole('button', { name: 'Update query' }).click();
	const sql = qbe.getByTestId('qbe-sql');
	await expect(sql).toContainText('LEFT JOIN `books` ON `books`.`author_id` = `authors`.`id`');
	await expect(sql).toContainText("WHERE (`authors`.`name` = 'Stanisław Lem')");

	await qbe.getByRole('button', { name: 'Submit query' }).click();
	await expect(page).toHaveURL(/\/db\/sma_test\/sql\?sql_query=SELECT/);
	expect(new URL(page.url()).searchParams.get('sql_query')).toContain('LEFT JOIN `books`');
});

test('multi-table query joins by foreign key and submits', async ({ page }) => {
	const main = page.getByRole('main');
	const mtq = main.getByTestId('mtq');

	await mtq.getByLabel('Table 1', { exact: true }).selectOption('authors');
	await mtq.getByLabel('Column 1', { exact: true }).selectOption('name');
	await mtq.getByLabel('Table 2', { exact: true }).selectOption('books');
	await mtq.getByLabel('Column 2', { exact: true }).selectOption('title');
	await mtq.getByLabel('Use column 2 in criteria').check();
	await mtq.getByLabel('Operator 2', { exact: true }).selectOption('LIKE %...%');
	await mtq.getByLabel('Criteria value 2', { exact: true }).fill('Sola');

	await mtq.getByRole('button', { name: 'Update query' }).click();
	const sql = mtq.getByTestId('mtq-sql');
	await expect(sql).toContainText('LEFT JOIN `books` ON `books`.`author_id` = `authors`.`id`');
	await expect(sql).toContainText("`books`.`title` LIKE '%Sola%'");

	await mtq.getByRole('button', { name: 'Submit query' }).click();
	await expect(page).toHaveURL(/\/db\/sma_test\/sql\?sql_query=SELECT/);
});

test('multi-table query reports an empty selection', async ({ page }) => {
	const mtq = page.getByRole('main').getByTestId('mtq');
	await mtq.getByRole('button', { name: 'Update query' }).click();
	await expect(mtq.getByRole('alert')).toContainText('Nothing selected');
});
