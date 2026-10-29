/**
 * pnpm site:screenshots
 *
 * Captures the marketing screenshots of the presentation site (site/assets/screenshots) from a running app.
 * Env: SITE_BASE_URL (default http://localhost:5173). Logs in as root/root on the default server, forces
 * English with the `sma_lang` cookie and emulates light/dark with Playwright's `colorScheme`
 * (the saved preferences of the user are never touched). Uses the fixture database `sma_test`.
 * Images are converted to WebP when `cwebp` is on the PATH, otherwise PNG files are kept.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Page } from '@playwright/test';

const BASE = (process.env.SITE_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '');
const OUT = join(import.meta.dirname, '..', '..', 'site', 'assets', 'screenshots');
const DB = 'sma_test';

type View = {
	name: string;
	/** Needs a logged-in session (false for the login page). */
	auth: boolean;
	path: string;
	prepare?: (page: Page) => Promise<void>;
};

const views: View[] = [
	{ name: 'login', auth: false, path: '/login' },
	{ name: 'home', auth: true, path: '/' },
	{ name: 'databases', auth: true, path: '/server/databases' },
	{ name: 'structure', auth: true, path: `/db/${DB}/structure` },
	{ name: 'browse', auth: true, path: `/db/${DB}/table/books/browse` },
	{
		name: 'sql',
		auth: true,
		path: `/db/${DB}/sql`,
		prepare: async (page) => {
			const main = page.getByRole('main');
			await main
				.getByRole('textbox', { name: 'SQL query' })
				.fill(
					'SELECT a.name AS author, b.title, b.price\nFROM books b\nJOIN authors a ON a.id = b.author_id\nORDER BY b.price DESC;'
				);
			await main.getByRole('button', { name: 'Go' }).click();
			await page.getByTestId('result-set').first().waitFor();
			// Bring the result grid into the 900 px viewport.
			await page
				.getByTestId('statement-result')
				.first()
				.evaluate((el) => {
					el.scrollIntoView({ block: 'end' });
				});
		}
	},
	{ name: 'designer', auth: true, path: `/db/${DB}/designer` },
	{ name: 'status', auth: true, path: '/server/status' },
	{ name: 'export', auth: true, path: `/db/${DB}/export` }
];

async function ready(page: Page) {
	await page.locator('html[data-hydrated="true"]').waitFor();
	await page.evaluate(() => document.fonts.ready);
	await page.waitForLoadState('networkidle').catch(() => {});
	await page.waitForTimeout(600);
}

/** Remove the SQL history rows created by the "sql" view (root's other data is never modified). */
async function cleanHistory() {
	try {
		const { createConnection } = await import('mysql2/promise');
		const c = await createConnection({
			host: process.env.SITE_DB_HOST ?? '127.0.0.1',
			port: Number(process.env.SITE_DB_PORT ?? 33306),
			user: 'root',
			password: 'root',
			connectTimeout: 2000
		});
		await c.query(
			"DELETE FROM `phpmyadmin`.`pma__history` WHERE db = ? AND sqlquery LIKE 'SELECT a.name AS author, b.title, b.price%'",
			[DB]
		);
		await c.end();
	} catch {
		console.warn('could not clean pma__history (database unreachable); entries left in place');
	}
}

await cleanHistory();
const browser = await chromium.launch();
mkdirSync(OUT, { recursive: true });
try {
	for (const scheme of ['light', 'dark'] as const) {
		const context = await browser.newContext({
			viewport: { width: 1440, height: 900 },
			colorScheme: scheme,
			locale: 'en-US'
		});
		await context.addCookies([{ name: 'sma_lang', value: 'en', url: BASE }]);
		const page = await context.newPage();

		// Login page first (anonymous), then sign in.
		for (const view of views.filter((v) => !v.auth)) {
			await page.goto(BASE + view.path);
			await ready(page);
			await page.screenshot({ path: join(OUT, `${view.name}-${scheme}.png`) });
		}
		await page.goto(BASE + '/login');
		await ready(page);
		await page.getByLabel('Username').fill('root');
		await page.getByLabel('Password').fill('root');
		await page.getByRole('button', { name: 'Log in' }).click();
		await page.waitForURL(/\/$/);
		await ready(page);

		for (const view of views.filter((v) => v.auth)) {
			await page.goto(BASE + view.path);
			await ready(page);
			await view.prepare?.(page);
			await page.waitForTimeout(400);
			await page.screenshot({ path: join(OUT, `${view.name}-${scheme}.png`) });
			console.log(`${view.name}-${scheme}`);
		}
		await context.close();
	}
} finally {
	await browser.close();
}

await cleanHistory();

// Optimise: PNG -> WebP when cwebp is available.
let hasCwebp = true;
try {
	execFileSync('cwebp', ['-version'], { stdio: 'ignore' });
} catch {
	hasCwebp = false;
	console.warn('cwebp not found: keeping PNG files');
}
if (hasCwebp) {
	for (const f of readdirSync(OUT).filter((n) => n.endsWith('.png'))) {
		const src = join(OUT, f);
		execFileSync('cwebp', [
			'-q',
			'86',
			'-m',
			'6',
			'-quiet',
			src,
			'-o',
			src.replace(/\.png$/, '.webp')
		]);
		unlinkSync(src);
	}
}
const total = readdirSync(OUT).reduce((n, f) => n + statSync(join(OUT, f)).size, 0);
console.log(`done: ${(total / 1024 / 1024).toFixed(2)} MB in ${OUT}`);
