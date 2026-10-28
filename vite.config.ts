import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	],
	test: {
		expect: { requireAssertions: true },
		projects: [
			{
				// Component tests in a real browser (vitest-browser-svelte + playwright).
				extends: './vite.config.ts',
				// Pre-bundle client deps up front: discovering them mid-run makes Vite re-optimise and
				// reload the test page (cold-start flake).
				optimizeDeps: {
					include: [
						'@lucide/svelte/icons/*',
						'bits-ui',
						'svelte-sonner',
						'mode-watcher',
						'paneforge',
						'tailwind-variants',
						'svelte/reactivity',
						'vitest-browser-svelte',
						'vitest/browser'
					]
				},
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{ browser: 'chromium', headless: true }]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},
			{
				// Pure logic, no database needed.
				extends: './vite.config.ts',
				test: {
					name: 'unit',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
					exclude: [
						'src/**/*.svelte.{test,spec}.{js,ts}',
						'src/**/*.integration.{test,spec}.{js,ts}'
					]
				}
			},
			{
				// Needs `pnpm db:up` (MySQL on :33306, MariaDB on :33307).
				extends: './vite.config.ts',
				test: {
					name: 'integration',
					environment: 'node',
					include: ['src/**/*.integration.{test,spec}.{js,ts}'],
					testTimeout: 30_000,
					hookTimeout: 30_000
				}
			}
		]
	}
});
