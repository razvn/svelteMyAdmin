import { XMLValidator } from 'fast-xml-parser';
import { parse as parseYaml } from 'yaml';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Connection } from '#lib/server/db/connection.ts';
import { exportPlugins } from './registry.ts';
import { driveExport, type ExportEnv, type ExportRequest } from './run.ts';
import { connect, defaultOptions, envFor, SERVERS } from './testing.ts';
import type { ExportPlugin } from './types.ts';

async function bytes(
	env: ExportEnv,
	plugin: ExportPlugin,
	req: Partial<ExportRequest>
): Promise<Buffer> {
	const parts: Buffer[] = [];
	await driveExport(
		env,
		{
			scope: 'table',
			databases: ['sma_test'],
			table: 'books',
			structureOrData: 'structure_and_data',
			...req,
			plugin,
			options: defaultOptions(plugin.id)
		},
		async (c) => {
			parts.push(typeof c === 'string' ? Buffer.from(c) : Buffer.from(c));
		}
	);
	return Buffer.concat(parts);
}

/** Every registered format must work end to end through the real framework. */
for (const server of SERVERS) {
	describe(`all export formats against ${server.label}`, () => {
		let conn: Connection | undefined;
		let env: ExportEnv;
		beforeAll(async () => {
			conn = await connect(server.port);
			if (conn) env = await envFor(conn, server.port);
		});
		afterAll(async () => {
			await conn?.end();
		});

		it('registers the expected formats', () => {
			expect(exportPlugins.map((p) => p.id)).toEqual(
				expect.arrayContaining([
					'sql',
					'csv',
					'json',
					'xml',
					'yaml',
					'ods',
					'odt',
					'pdf',
					'codegen',
					'excel'
				])
			);
		});

		for (const plugin of exportPlugins) {
			it(`${plugin.id}: table, database and raw scopes produce output`, async ({ skip }) => {
				if (!conn) return skip();
				const check = (out: Buffer) => {
					expect(out.length).toBeGreaterThan(0);
					const text = out.toString('utf8');
					if (plugin.id === 'json') expect(() => JSON.parse(text)).not.toThrow();
					if (plugin.id === 'xml') expect(XMLValidator.validate(text)).toBe(true);
					if (plugin.id === 'yaml') expect(() => parseYaml(text)).not.toThrow();
					if (plugin.binary) expect(out.subarray(0, 2).toString()).toMatch(/PK|%P/);
					return text;
				};
				if (plugin.scopes.includes('table')) {
					const text = check(await bytes(env, plugin, {}));
					if (!plugin.binary && plugin.supports.data && plugin.id !== 'codegen') {
						expect(text).toContain('Solaris');
					}
				}
				if (plugin.scopes.includes('database')) {
					check(
						await bytes(env, plugin, {
							scope: 'database',
							tables: [
								{ name: 'books', structure: true, data: true },
								{ name: 'authors', structure: true, data: true },
								{ name: 'v_book_authors', structure: true, data: false }
							]
						})
					);
				}
				if (plugin.scopes.includes('raw')) {
					check(
						await bytes(env, plugin, {
							scope: 'raw',
							sqlQuery: 'SELECT id, title FROM books ORDER BY id',
							structureOrData: 'data'
						})
					);
				}
			});
		}

		it('keeps the connection usable after plugins that do not drain the rows (codegen)', async ({
			skip
		}) => {
			if (!conn) return skip();
			const codegen = exportPlugins.find((p) => p.id === 'codegen')!;
			await bytes(env, codegen, {});
			const [r] = await conn.query('SELECT 1 AS ok');
			expect(Number((r as { ok: number }[])[0].ok)).toBe(1);
		});
	});
}
