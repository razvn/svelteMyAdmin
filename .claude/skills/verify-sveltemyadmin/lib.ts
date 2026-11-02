// Helpers for verification journeys. Run journeys through `sma-verify run <file>`, which sets
// SMA_URL, SMA_EVIDENCE and SMA_RUN_ID. Plain Node (type stripping), no test runner.
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { expect } from '@playwright/test';
import { createConnection, type Connection } from 'mysql2/promise';

export { expect };

function env(name: string): string {
	const value = process.env[name];
	if (!value) throw new Error(`${name} is not set: run this file with sma-verify run <file>`);
	return value;
}

export const baseUrl = env('SMA_URL');
export const runId = env('SMA_RUN_ID');
const evidenceRoot = env('SMA_EVIDENCE');

/** Name for a database owned by this run; `sma-verify down` drops every leftover one. */
export const tmpDb = (suffix: string) => `tmp_verify_${runId}_${suffix}`;

/** Direct root connection, for preconditions and for checking side effects (never to drive the feature). */
export async function withRoot<T>(fn: (c: Connection) => Promise<T>, port = 33306): Promise<T> {
	const c = await createConnection({
		host: '127.0.0.1',
		port,
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

/** Navigate and wait for hydration (the root layout sets html[data-hydrated="true"]). */
export async function gotoReady(page: Page, path: string) {
	await page.goto(new URL(path, baseUrl).href);
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
}

/**
 * Log in through the real login form. `server` is the 1-based index in config.sample.json
 * (1 MySQL 8.4 + pmadb, 2 MariaDB 11.4 + SQLite storage, 3 MariaDB without storage).
 */
export async function login(page: Page, opts: { server?: number; password?: string } = {}) {
	await gotoReady(page, opts.server ? `/login?server=${opts.server}` : '/login');
	await page.getByLabel('Username').fill('root');
	await page.getByLabel('Password').fill(opts.password ?? 'root');
	await page.getByRole('button', { name: 'Log in' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.locator('html')).toHaveAttribute('data-hydrated', 'true');
}

type Journey = {
	page: Page;
	dir: string;
	/** Log one user action and its expected result in journal.md. */
	step: (text: string) => void;
	/** ARIA snapshot + full-page screenshot, named `<nn>-<name>`. */
	proof: (name: string) => Promise<void>;
	/** Write any extra artifact (query results, downloaded file text) into the evidence dir. */
	save: (file: string, content: string | Buffer) => void;
};

/**
 * Run one feature journey: opens Chromium, records journal.md + proofs under
 * $SMA_EVIDENCE/<featureId>/, captures a `failure` proof on error and sets the exit code.
 */
export async function journey(featureId: string, fn: (j: Journey) => Promise<void>) {
	const dir = join(evidenceRoot, featureId);
	mkdirSync(dir, { recursive: true });
	const journal = join(dir, 'journal.md');
	writeFileSync(
		journal,
		`# ${featureId} (run ${runId}, ${baseUrl}, ${new Date().toISOString()})\n\n`
	);
	let n = 0;
	const browser: Browser = await chromium.launch({ headless: !process.env.SMA_HEADED });
	const context = await browser.newContext({
		viewport: { width: 1440, height: 900 },
		acceptDownloads: true
	});
	const page = await context.newPage();
	const j: Journey = {
		page,
		dir,
		step: (text) => {
			appendFileSync(journal, `- ${text}\n`);
			console.log(`[${featureId}] ${text}`);
		},
		proof: async (name) => {
			const base = `${String(++n).padStart(2, '0')}-${name}`;
			writeFileSync(
				join(dir, `${base}.aria.txt`),
				`URL: ${page.url()}\n\n${await page.locator('body').ariaSnapshot()}\n`
			);
			await page.screenshot({ path: join(dir, `${base}.png`), fullPage: true });
			appendFileSync(journal, `  - proof: ${base}.png, ${base}.aria.txt (${page.url()})\n`);
		},
		save: (file, content) => {
			writeFileSync(join(dir, file), content);
			appendFileSync(journal, `  - saved: ${file}\n`);
		}
	};
	try {
		await fn(j);
		appendFileSync(journal, '\nRESULT: PASS\n');
		console.log(`[${featureId}] PASS, evidence in ${dir}`);
	} catch (error) {
		await j.proof('failure').catch(() => {});
		appendFileSync(
			journal,
			`\nRESULT: FAIL\n\n\`\`\`\n${(error as Error).stack ?? error}\n\`\`\`\n`
		);
		console.error(`[${featureId}] FAIL, evidence in ${dir}\n`, error);
		process.exitCode = 1;
	} finally {
		await browser.close();
	}
}
