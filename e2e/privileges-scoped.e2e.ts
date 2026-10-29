import { expect, test, type Page } from '@playwright/test';
import { createConnection } from 'mysql2/promise';
import { gotoReady, login } from './helpers.ts';

const USER = 'tmp_t7b_e2e';
const RENAMED = 'tmp_t7b_e2e_renamed';
const MEMBER = 'tmp_t7b_e2e_member';
const ROLE = 'tmp_t7b_e2e_role';
const DB = 'tmp_t7b_e2e_db';

async function sql(statements: string[]) {
	const c = await createConnection({
		host: '127.0.0.1',
		port: 33306,
		user: 'root',
		password: 'root'
	});
	try {
		const out: unknown[] = [];
		for (const s of statements) out.push((await c.query(s))[0]);
		return out;
	} finally {
		await c.end();
	}
}
const cleanup = () =>
	sql([
		`DROP USER IF EXISTS '${USER}'@'%'`,
		`DROP USER IF EXISTS '${RENAMED}'@'%'`,
		`DROP USER IF EXISTS '${MEMBER}'@'%'`,
		`DROP ROLE IF EXISTS '${ROLE}'@'%'`,
		`DROP DATABASE IF EXISTS \`${DB}\``
	]);

let dbUp = false;
test.beforeAll(async () => {
	try {
		await cleanup();
		await sql([
			`CREATE DATABASE \`${DB}\``,
			`CREATE TABLE \`${DB}\`.t (a INT, b INT)`,
			`CREATE USER '${USER}'@'%' IDENTIFIED BY 'E2e-Pass-1!'`,
			`CREATE USER '${MEMBER}'@'%' IDENTIFIED BY 'E2e-Pass-1!'`
		]);
		dbUp = true;
	} catch {
		dbUp = false;
	}
});
test.afterAll(async () => {
	if (dbUp) await cleanup();
});
test.beforeEach(() => {
	test.skip(!dbUp, 'MySQL fixture on 127.0.0.1:33306 unreachable (run pnpm db:up)');
});

const main = (page: Page) => page.getByRole('main');
const q = (user: string) => `username=${user}&hostname=%25`;

test.describe.configure({ mode: 'serial' });

test('grant database, table and column privileges, see them in the db/table pages, rename the user', async ({
	page
}) => {
	await login(page);

	// database level, picked from the list (wildcards escaped)
	await gotoReady(page, `/server/privileges/edit/database?${q(USER)}`);
	await main(page).locator('#dbpick').selectOption(DB);
	await main(page).getByTestId('add-database-go').click();
	await expect(main(page).getByTestId('scoped-editor')).toBeVisible();
	await main(page).getByRole('checkbox', { name: 'SELECT', exact: true }).click();
	await main(page).getByRole('checkbox', { name: 'INSERT', exact: true }).click();
	await main(page).getByTestId('save-privileges').click();
	await expect(main(page).getByTestId('privileges-saved')).toBeVisible();
	await expect(main(page).getByTestId('statement-list')).toContainText(
		`GRANT SELECT, INSERT ON \`${DB.replace(/_/g, '\\_')}\`.*`
	);
	await expect(main(page).getByTestId('database-grants')).toContainText(DB.replace(/_/g, '\\_'));

	// table + column level
	await gotoReady(page, `/server/privileges/edit/table?${q(USER)}&dbname=${DB}&tablename=t`);
	await main(page).getByRole('checkbox', { name: 'DELETE', exact: true }).click();
	await main(page).locator('#col-SELECT').selectOption(['a']);
	await main(page).locator('#col-UPDATE').selectOption(['a', 'b']);
	await main(page).getByTestId('save-privileges').click();
	await expect(main(page).getByTestId('privileges-saved')).toBeVisible();
	await expect(main(page).getByTestId('statement-list')).toContainText('GRANT DELETE ON');
	await expect(main(page).getByTestId('statement-list')).toContainText(
		'SELECT (`a`), UPDATE (`a`, `b`)'
	);
	await expect(main(page).getByTestId('table-grants')).toContainText('SELECT (a)');

	// Column tab opens the column section of the table editor
	await main(page).locator('[data-tab="column"]').click();
	await expect(page).toHaveURL(/\/edit\/table\?.*#column-privileges/);

	// database + table privileges pages list the user
	await gotoReady(page, `/db/${DB}/privileges`);
	const dbRow = main(page).locator(`tr[data-user="${USER}"]`);
	await expect(dbRow).toHaveCount(1);
	await expect(dbRow).toContainText('database-specific');
	await expect(dbRow).toContainText('SELECT, INSERT');
	await expect(main(page).getByTestId('add-user')).toHaveAttribute(
		'href',
		`/server/privileges/add?dbname=${DB}`
	);
	await gotoReady(page, `/db/${DB}/table/t/privileges`);
	const rows = main(page).locator(`tr[data-user="${USER}"]`);
	await expect(rows).toHaveCount(2);
	await expect(rows.nth(1)).toContainText('table-specific');
	await rows
		.nth(0)
		.getByRole('link', { name: /Edit privileges/ })
		.click();
	await expect(page).toHaveURL(/\/server\/privileges\/edit\/database/);

	// rename through Login information (mode: delete the old one)
	await gotoReady(page, `/server/privileges/edit/login?${q(USER)}`);
	await main(page).locator('#login-username').fill(RENAMED);
	await main(page)
		.getByRole('radio', { name: /delete the old one from the user tables\.$/ })
		.check();
	await main(page).getByTestId('change-login-go').click();
	await expect(main(page).getByTestId('privileges-saved')).toBeVisible();
	await expect(main(page).getByTestId('statement-list')).toContainText('RENAME USER');
	const [users] = (await sql([
		`SELECT User FROM mysql.user WHERE User IN ('${USER}', '${RENAMED}')`
	])) as { User: string }[][];
	expect(users.map((u) => u.User)).toEqual([RENAMED]);
	await gotoReady(page, `/db/${DB}/privileges`);
	await expect(main(page).locator(`tr[data-user="${RENAMED}"]`)).toHaveCount(1);
});

test('create a role, grant it to a user and drop it', async ({ page }) => {
	await login(page);
	await gotoReady(page, '/server/privileges');
	await main(page).getByRole('textbox', { name: 'Role name' }).fill(ROLE);
	await main(page).getByTestId('create-role').click();
	await expect(main(page).getByTestId('role-created')).toBeVisible();
	const roleRow = main(page).locator(`tr[data-role="${ROLE}"]`);
	await expect(roleRow).toBeVisible();
	// roles are not listed among the user accounts
	await expect(
		main(page).getByTestId('accounts-table').locator(`tr[data-user="${ROLE}"]`)
	).toHaveCount(0);

	await gotoReady(page, `/server/privileges/edit/roles?${q(MEMBER)}`);
	await main(page)
		.getByRole('combobox', { name: 'Role' })
		.selectOption({ label: `${ROLE}@%` });
	await main(page).getByRole('checkbox', { name: 'WITH ADMIN OPTION' }).click();
	await main(page).getByTestId('grant-role-go').click();
	await expect(main(page).getByTestId('statement-list')).toContainText(
		`GRANT '${ROLE}'@'%' TO '${MEMBER}'@'%' WITH ADMIN OPTION`
	);
	const granted = main(page).locator(`tr[data-role="${ROLE}"]`);
	await expect(granted).toContainText('Yes');
	await granted.getByRole('checkbox', { name: `Default role ${ROLE}` }).click();
	await main(page).getByTestId('save-defaults').click();
	await expect(main(page).getByTestId('statement-list')).toContainText('SET DEFAULT ROLE');

	await gotoReady(page, '/server/privileges');
	await expect(roleRow.locator('td').nth(2)).toHaveText('1');
	await roleRow.getByRole('button', { name: `Drop role ${ROLE}` }).click();
	await page.getByRole('alertdialog').getByRole('button', { name: 'Drop' }).click();
	await expect(roleRow).toHaveCount(0);
});
