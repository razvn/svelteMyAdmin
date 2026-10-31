import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../../config/loader.ts';
import { defineRepoContract } from '../contract.ts';
import { storageKind, storageRepos, storageServerId } from '../index.ts';
import { closeAllSqlite, migrate, openSqlite, SCHEMA_VERSION, SqliteStore } from './db.ts';
import { sqliteRepos } from './repos.ts';

const dir = mkdtempSync(join(tmpdir(), 'tmp_t11_unit_'));
afterAll(() => {
	closeAllSqlite();
	rmSync(dir, { recursive: true, force: true });
});

const store = (file: string, server = 'srv:1') => new SqliteStore(openSqlite(file), server);

// The whole contract on a real file (WAL), as production uses it.
defineRepoContract('sqlite', async () => ({
	repos: sqliteRepos(store(join(dir, 'contract.sqlite')))
}));

describe('sqlite storage file', () => {
	it('creates the schema, sets user_version and migrates idempotently', () => {
		const file = join(dir, 'schema.sqlite');
		const db = openSqlite(file);
		const version = db.prepare('PRAGMA user_version').get() as { user_version: number };
		expect(version.user_version).toBe(SCHEMA_VERSION);
		const mode = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
		expect(mode.journal_mode).toBe('wal');
		const tables = (
			db
				.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'pma__%'")
				.all() as {
				name: string;
			}[]
		).map((r) => r.name);
		expect(tables).toHaveLength(19);
		// every table carries the server column
		for (const t of tables) {
			const cols = (db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map(
				(c) => c.name
			);
			expect(cols, t).toContain('server');
		}
		const raw = new DatabaseSync(':memory:');
		migrate(raw);
		migrate(raw);
		expect(
			(raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
		).toBe(SCHEMA_VERSION);
		raw.close();
	});

	it('opens one connection per file', () => {
		const file = join(dir, 'one.sqlite');
		expect(openSqlite(file)).toBe(openSqlite(file));
	});

	it('keeps the servers of one file apart', async () => {
		const file = join(dir, 'servers.sqlite');
		const a = sqliteRepos(store(file, 'db-a:3306'));
		const b = sqliteRepos(store(file, 'db-b:3306'));
		await a.userConfig!.save('root', { MaxRows: 10 });
		await a.favorite!.replace('root', [{ db: 'x', table: 'y' }]);
		await a.bookmarks!.insert('root', {
			db: '',
			label: 'l',
			query: 'q',
			shared: true,
			replace: false
		});
		expect(await b.userConfig!.load('root')).toBeNull();
		expect(await b.favorite!.select('root')).toEqual([]);
		expect(await b.bookmarks!.list('root', '')).toEqual([]);
		await b.userConfig!.save('root', { MaxRows: 99 });
		expect((await a.userConfig!.load('root'))?.data).toEqual({ MaxRows: 10 });
		expect((await b.userConfig!.load('root'))?.data).toEqual({ MaxRows: 99 });
	});
});

describe('backend resolution', () => {
	const base = {
		Servers: [
			{ host: '127.0.0.1', port: 33306, pmadb: 'phpmyadmin', bookmarktable: 'pma__bookmark' },
			{ host: '127.0.0.1', port: 33307 }
		]
	};

	it('without ConfigStorage nothing changes: pmadb servers use MySQL, others have no features', () => {
		const [mysql, plain] = parseConfig(base, dir).Servers;
		expect(plain.sqlite_storage).toBeUndefined();
		expect(storageKind(mysql)).toBe('mysql');
		expect(storageKind(plain)).toBe('none');
		const repos = storageRepos(plain, async () => Promise.reject(new Error('unused')));
		expect(repos.bookmarks).toBeNull();
		expect(repos.userConfig).toBeNull();
	});

	it('ConfigStorage sqlite applies to servers without pmadb only, relative to the config dir', () => {
		const cfg = parseConfig(
			{ ...base, ConfigStorage: { type: 'sqlite', path: './var/s.sqlite' } },
			dir
		);
		const [mysql, plain] = cfg.Servers;
		expect(mysql.sqlite_storage).toBeUndefined();
		expect(storageKind(mysql)).toBe('mysql');
		expect(plain.sqlite_storage).toBe(join(dir, 'var', 's.sqlite'));
		expect(storageKind(plain)).toBe('sqlite');
		const repos = storageRepos(plain, async () => Promise.reject(new Error('unused')));
		expect(repos.kind).toBe('sqlite');
		for (const [key, repo] of Object.entries(repos)) expect(repo, key).not.toBeNull();
	});

	it('a server can opt out with ConfigStorage: false', () => {
		const cfg = parseConfig(
			{
				ConfigStorage: { type: 'sqlite', path: 'x.sqlite' },
				Servers: [{ host: 'a' }, { host: 'b', ConfigStorage: false }]
			},
			dir
		);
		expect(storageKind(cfg.Servers[0])).toBe('sqlite');
		expect(storageKind(cfg.Servers[1])).toBe('none');
	});

	it('an absolute path stays as it is and a bad type is rejected', () => {
		const abs = join(dir, 'abs.sqlite');
		const cfg = parseConfig({ Servers: [{}], ConfigStorage: { type: 'sqlite', path: abs } }, '/x');
		expect(cfg.Servers[0].sqlite_storage).toBe(abs);
		expect(() => parseConfig({ ConfigStorage: { type: 'mysql', path: 'a' } })).toThrow();
		expect(() => parseConfig({ ConfigStorage: { type: 'sqlite' } })).toThrow();
	});

	it('the server id is host:port (default port 3306) or the socket, independent of the order', () => {
		expect(storageServerId({ host: '127.0.0.1', port: 33307, socket: '' })).toBe('127.0.0.1:33307');
		expect(storageServerId({ host: 'localhost', port: 0, socket: '' })).toBe('localhost:3306');
		expect(storageServerId({ host: 'localhost', port: 0, socket: '/tmp/mysql.sock' })).toBe(
			'socket:/tmp/mysql.sock'
		);
	});
});
