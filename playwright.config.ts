import { defineConfig } from '@playwright/test';

// The preview server uses the sample config (MySQL :33306 / MariaDB :33307, cookie auth)
// unless SMA_CONFIG is set explicitly.
const config = process.env.SMA_CONFIG ?? 'config.sample.json';
// Override to run several e2e suites in parallel (e.g. one per git worktree).
const port = Number(process.env.PW_PORT ?? 4173);

export default defineConfig({
	webServer: {
		command: `pnpm build && pnpm preview --port ${port} --strictPort`,
		port,
		reuseExistingServer: !process.env.CI,
		env: { SMA_CONFIG: config }
	},
	use: { baseURL: `http://localhost:${port}` },
	testDir: 'e2e',
	testMatch: '**/*.e2e.{ts,js}'
});
