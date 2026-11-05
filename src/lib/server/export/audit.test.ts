import { describe, expect, it } from 'vitest';
import { exportAuditBody } from './endpoint.ts';
import type { ExportRequest } from './run.ts';

const base = (over: Partial<ExportRequest>): ExportRequest =>
	({
		plugin: { id: 'csv' },
		options: {},
		structureOrData: 'data',
		databases: ['shop'],
		...over
	}) as ExportRequest;

describe('export audit event', () => {
	it('names what left the server for each scope', () => {
		expect(exportAuditBody(base({ scope: 'server', databases: ['shop', 'crm'] }))).toEqual({
			event: 'export',
			scope: 'server',
			format: 'csv',
			databases: ['shop', 'crm']
		});
		expect(
			exportAuditBody(
				base({
					scope: 'database',
					tables: [{ name: 'orders', structure: true, data: true }]
				})
			)
		).toEqual({ event: 'export', scope: 'db', format: 'csv', db: 'shop', tables: ['orders'] });
		expect(exportAuditBody(base({ scope: 'table', table: 'orders', allRows: true }))).toEqual({
			event: 'export',
			scope: 'table',
			format: 'csv',
			db: 'shop',
			tables: ['orders']
		});
	});

	it('selected rows and query results are `rows` exports, with the query', () => {
		expect(
			exportAuditBody(base({ scope: 'table', table: 'orders', where: ['`id` = 1'] }))
		).toMatchObject({ scope: 'rows', db: 'shop', tables: ['orders'] });
		expect(exportAuditBody(base({ scope: 'raw', sqlQuery: 'SELECT email FROM users' }))).toEqual({
			event: 'export',
			scope: 'rows',
			format: 'csv',
			db: 'shop',
			sql: 'SELECT email FROM users'
		});
	});
});
