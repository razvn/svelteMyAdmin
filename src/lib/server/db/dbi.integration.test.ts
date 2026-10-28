import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from './connection';
import { DatabaseInterface } from './dbi';

const servers = [
	{ name: 'mysql 8.4', port: 33306, type: 'MySQL' },
	{ name: 'mariadb 11.4', port: 33307, type: 'MariaDB' }
];

for (const { name, port, type } of servers) {
	describe(`DatabaseInterface against ${name}`, () => {
		let conn: Connection | undefined;
		let dbi: DatabaseInterface;
		const cfg = { only_db: '' as string | string[], hide_db: '', host: '127.0.0.1', port };

		beforeAll(async () => {
			try {
				conn = await createConnection(
					{
						host: '127.0.0.1',
						port,
						socket: '',
						ssl: false,
						ssl_ca: null,
						ssl_cert: null,
						ssl_key: null,
						ssl_ciphers: null,
						ssl_verify: true,
						compress: false
					},
					'root',
					'root'
				);
				dbi = new DatabaseInterface(conn, cfg);
			} catch {
				console.warn(`[integration] ${name} unreachable on 127.0.0.1:${port}, skipping`);
			}
		});
		afterAll(async () => {
			await conn?.end();
		});

		it('getServerInfo', async ({ skip }) => {
			if (!conn) return skip();
			const info = await dbi.getServerInfo();
			expect(info.serverType).toBe(type);
			expect(info.versionInt).toBeGreaterThan(50000);
			expect(info.currentUser).toMatch(/^root@/);
			expect(info.charset).toBeTruthy();
			expect(info.collation).toBeTruthy();
			expect(info.hostname).toBeTruthy();
			expect(info.protocolVersion).toBe(10);
		});

		it('listDatabases honours only_db / hide_db', async ({ skip }) => {
			if (!conn) return skip();
			expect(await dbi.listDatabases()).toContain('sma_test');
			cfg.only_db = 'sma_%';
			expect((await dbi.listDatabases()).filter((d) => !/^sma_t\d/.test(d))).toEqual(['sma_test']);
			cfg.only_db = '';
			cfg.hide_db = '^(information_schema|mysql|performance_schema|sys)$';
			const dbs = await dbi.listDatabases();
			expect(dbs).toContain('sma_test');
			expect(dbs).not.toContain('mysql');
			cfg.hide_db = '';
		});

		it('listTables', async ({ skip }) => {
			if (!conn) return skip();
			const tables = await dbi.listTables('sma_test');
			expect(tables.map((t) => t.name)).toEqual([
				'audit_log',
				'authors',
				'books',
				'type_zoo',
				'v_book_authors'
			]);
			const authors = tables.find((t) => t.name === 'authors')!;
			expect(authors.type).toBe('BASE TABLE');
			expect(authors.engine).toBe('InnoDB');
			expect(authors.comment).toBe('Book authors');
			expect(authors.collation).toBe('utf8mb4_unicode_ci');
			expect(typeof authors.dataLength).toBe('number');
			expect(tables.find((t) => t.name === 'v_book_authors')!.type).toBe('VIEW');
			expect(await dbi.listTables("no such`db'")).toEqual([]);
		});

		it('listRoutines / listEvents / listTriggers', async ({ skip }) => {
			if (!conn) return skip();
			const routines = await dbi.listRoutines('sma_test');
			expect(routines.map((r) => [r.name, r.type])).toEqual([
				['fn_book_count', 'FUNCTION'],
				['sp_books_by_author', 'PROCEDURE']
			]);
			expect(routines[0].deterministic).toBe(true);
			const events = await dbi.listEvents('sma_test');
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				name: 'ev_cleanup_audit_log',
				comment: 'Purge old audit rows'
			});
			const triggers = await dbi.listTriggers('sma_test');
			expect(triggers).toHaveLength(1);
			expect(triggers[0]).toMatchObject({
				name: 'trg_books_after_insert',
				event: 'INSERT',
				table: 'books',
				timing: 'AFTER'
			});
		});

		it('getColumns / getIndexes', async ({ skip }) => {
			if (!conn) return skip();
			const cols = await dbi.getColumns('sma_test', 'books');
			expect(cols.map((c) => c.field)).toEqual([
				'id',
				'author_id',
				'title',
				'price',
				'published_at',
				'updated_at',
				'status'
			]);
			expect(cols[0]).toMatchObject({ key: 'PRI', null: false });
			expect(cols[0].extra).toContain('auto_increment');
			expect(cols.find((c) => c.field === 'published_at')!.null).toBe(true);
			const idx = await dbi.getIndexes('sma_test', 'books');
			expect(idx.map((i) => i.keyName).sort()).toEqual([
				'PRIMARY',
				'ft_books_title',
				'idx_books_author'
			]);
			expect(idx.find((i) => i.keyName === 'PRIMARY')!.nonUnique).toBe(false);
			await expect(dbi.getColumns('sma_test', 'nope')).rejects.toThrow();
		});

		it('databaseExists / getTableType / listCollations / isSslConnection', async ({ skip }) => {
			if (!conn) return skip();
			expect(await dbi.databaseExists('sma_test')).toBe(true);
			expect(await dbi.databaseExists('SMA_TEST')).toBe(false);
			expect(await dbi.databaseExists('doesnotexist')).toBe(false);
			expect(await dbi.getTableType('sma_test', 'books')).toBe('BASE TABLE');
			expect(await dbi.getTableType('sma_test', 'v_book_authors')).toBe('VIEW');
			expect(await dbi.getTableType('sma_test', 'nope')).toBeNull();
			const collations = await dbi.listCollations();
			expect(collations.map((c) => c.name)).toContain('utf8mb4_general_ci');
			expect(typeof (await dbi.isSslConnection())).toBe('boolean');
		});
	});
}
