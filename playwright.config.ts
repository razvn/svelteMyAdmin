import { defineConfig } from '@playwright/test';

// The preview server uses the sample config (MySQL :33306 / MariaDB :33307, cookie auth)
// unless SMA_CONFIG is set explicitly.
const config = process.env.SMA_CONFIG ?? 'config.sample.json';

export default defineConfig({
	webServer: {
		command: 'pnpm build && pnpm preview --port 4173',
		port: 4173,
		reuseExistingServer: !process.env.CI,
		env: { SMA_CONFIG: config }
	},
	use: { baseURL: 'http://localhost:4173' },
	testDir: 'e2e',
	testMatch: '**/*.e2e.{ts,js}'
});
