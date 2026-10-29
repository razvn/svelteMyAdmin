import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '../db/connection';
import { DatabaseInterface } from '../db/dbi';
import {
	accountExists,
	changePassword,
	createAccount,
	dropAccounts,
	exportGrants,
	getCapabilities,
	getPrivServer,
	listAccounts,
	listActiveAuthPlugins,
	planGlobalUpdate,
	readAccount,
	readAccountProperties,
	updateGlobalPrivileges,
	withPrivilegeSummaries,
	type Capabilities
} from './index';
import {
	NO_LIMITS,
	NO_SSL,
	quoteAccount,
	type Account,
	type PrivServer
} from '#lib/sql/privileges/index.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

const serverConfig = (port: number) => ({
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
});

for (const { name, port } of servers) {
	describe(`privileges against ${name}`, () => {
		let conn: Connection | undefined;
		let dbi: DatabaseInterface;
		let server: PrivServer;
		let caps: Capabilities;
		const p = (s: string) => `tmp_t7a_${s}_${port}`;
		const created: Account[] = [];
		const databases = [p('db1'), p('same')];

		const track = (a: Account) => {
			created.push(a);
			return a;
		};
		const input = (account: Account, extra: Partial<Parameters<typeof createAccount>[3]> = {}) => ({
			account,
			password: 'Pw-1!x',
			privileges: [] as string[],
			grantOption: false,
			ssl: NO_SSL,
			limits: NO_LIMITS,
			databases: {},
			...extra
		});
		const login = async (user: string, password: string) => {
			const c = await createConnection(serverConfig(port), user, password);
			try {
				const [rows] = await c.query('SELECT CURRENT_USER() AS u');
				return String((rows as { u: string }[])[0].u);
			} finally {
				await c.end();
			}
		};

		beforeAll(async () => {
			try {
				conn = await createConnection(serverConfig(port), 'root', 'root');
				dbi = new DatabaseInterface(conn, { only_db: '', hide_db: '', host: '127.0.0.1', port });
				const [old] = await conn.query(
					"SELECT User, Host FROM mysql.user WHERE User LIKE 'tmp\\_t7a\\_%'"
				);
				for (const u of old as { User: string; Host: string }[]) {
					await conn.query(`DROP USER IF EXISTS ${quoteAccount({ user: u.User, host: u.Host })}`);
				}
				for (const d of databases) await conn.query(`DROP DATABASE IF EXISTS \`${d}\``);
				server = await getPrivServer(dbi);
				caps = await getCapabilities(dbi);
			} catch {
				conn = undefined;
				console.warn(`[integration] ${name} unreachable on 127.0.0.1:${port}, skipping`);
			}
		});
		afterAll(async () => {
			if (!conn) return;
			for (const a of created) {
				await conn.query(`DROP USER IF EXISTS ${quoteAccount(a)}`);
			}
			for (const d of databases) await conn.query(`DROP DATABASE IF EXISTS \`${d}\``);
			await conn.end();
		});

		it('detects the server and root capabilities', async ({ skip }) => {
			if (!conn) return skip();
			expect(server.isMariaDB).toBe(port === 33307);
			expect(server.version).toBeGreaterThan(port === 33307 ? 110000 : 80000);
			expect(caps.isSuperUser).toBe(true);
			expect(caps.isCreateUser).toBe(true);
			expect(caps.isGrantUser).toBe(true);
			expect(caps.currentUser.user).toBe('root');
		});

		it('lists active authentication plugins', async ({ skip }) => {
			if (!conn) return skip();
			const names = (await listActiveAuthPlugins(dbi)).map((x) => x.name);
			expect(names).toContain(server.isMariaDB ? 'mysql_native_password' : 'caching_sha2_password');
		});

		it('creates users with each available authentication plugin and they can log in', async ({
			skip
		}) => {
			if (!conn) return skip();
			const active = (await listActiveAuthPlugins(dbi)).map((x) => x.name);
			const plugins = server.isMariaDB
				? ['mysql_native_password', 'ed25519'].filter((x) => active.includes(x))
				: ['caching_sha2_password', 'mysql_native_password', 'sha256_password'].filter((x) =>
						active.includes(x)
					);
			expect(plugins.length).toBeGreaterThan(0);
			for (const plugin of plugins) {
				const acc = track({ user: p(`auth_${plugin.slice(0, 6)}`), host: '%' });
				const res = await createAccount(
					dbi,
					server,
					caps,
					input(acc, { plugin, privileges: ['SELECT'] })
				);
				expect(res.error, plugin).toBeUndefined();
				expect(res.ok, JSON.stringify(res.results)).toBe(true);
				expect((await readAccountProperties(dbi, server, acc)).plugin).toBe(plugin);
				expect(await login(acc.user, 'Pw-1!x')).toBe(`${acc.user}@%`);
			}
		});

		it('creates a user without password and rejects a duplicate', async ({ skip }) => {
			if (!conn) return skip();
			const acc = track({ user: p('nopw'), host: 'localhost' });
			const res = await createAccount(dbi, server, caps, input(acc, { password: '' }));
			expect(res.ok).toBe(true);
			expect((await readAccountProperties(dbi, server, acc)).hasPassword).toBe(false);
			const again = await createAccount(dbi, server, caps, input(acc));
			expect(again.ok).toBe(false);
			expect(again.error).toMatch(/already exists/);
			expect(again.results).toEqual([]);
		});

		it('creates a user with global privileges, grant option, limits and SSL', async ({ skip }) => {
			if (!conn) return skip();
			const acc = track({ user: p('full'), host: '%' });
			const res = await createAccount(
				dbi,
				server,
				caps,
				input(acc, {
					privileges: ['SELECT', 'INSERT', 'CREATE TEMPORARY TABLES'],
					grantOption: true,
					ssl: { type: 'ANY' },
					limits: { maxQuestions: 100, maxConnections: 50, maxUpdates: 10, maxUserConnections: 3 }
				})
			);
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			const d = await readAccount(dbi, server, acc);
			expect(d.grantsError).toBeNull();
			expect(d.grants.global.privileges.sort()).toEqual(
				['CREATE TEMPORARY TABLES', 'INSERT', 'SELECT'].sort()
			);
			expect(d.grants.global.grantOption).toBe(true);
			expect(d.properties.ssl.type).toBe('ANY');
			expect(d.properties.limits).toEqual({
				maxQuestions: 100,
				maxConnections: 50,
				maxUpdates: 10,
				maxUserConnections: 3
			});
			// the password of the stored hash is never shown in the reported statements
			expect(JSON.stringify(res.results)).not.toContain('Pw-1!x');
			expect(res.results[0].statement).toContain('IDENTIFIED');
			expect(res.results[0].statement).toContain("'***'");
		});

		it('diffs global privileges: GRANT the added, REVOKE the removed, nothing else', async ({
			skip
		}) => {
			if (!conn) return skip();
			const acc = track({ user: p('diff'), host: '%' });
			await createAccount(dbi, server, caps, input(acc, { privileges: ['SELECT', 'INSERT'] }));
			const base = { account: acc, ssl: NO_SSL, limits: NO_LIMITS, grantOption: false };

			const plan = await planGlobalUpdate(dbi, server, {
				...base,
				privileges: ['SELECT', 'UPDATE', 'DELETE']
			});
			expect(plan.map((s) => s.sql)).toEqual([
				`REVOKE INSERT ON *.* FROM '${acc.user}'@'%'`,
				`GRANT UPDATE, DELETE ON *.* TO '${acc.user}'@'%'`
			]);
			const res = await updateGlobalPrivileges(dbi, server, caps, {
				...base,
				privileges: ['SELECT', 'UPDATE', 'DELETE']
			});
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			expect((await readAccount(dbi, server, acc)).grants.global.privileges.sort()).toEqual([
				'DELETE',
				'SELECT',
				'UPDATE'
			]);

			// no change -> no statements
			expect(
				await planGlobalUpdate(dbi, server, { ...base, privileges: ['SELECT', 'UPDATE', 'DELETE'] })
			).toEqual([]);

			// grant option on and off
			let r = await updateGlobalPrivileges(dbi, server, caps, {
				...base,
				grantOption: true,
				privileges: ['SELECT', 'UPDATE', 'DELETE']
			});
			expect(r.ok, JSON.stringify(r.results)).toBe(true);
			expect((await readAccount(dbi, server, acc)).grants.global.grantOption).toBe(true);
			r = await updateGlobalPrivileges(dbi, server, caps, {
				...base,
				privileges: ['SELECT', 'UPDATE', 'DELETE']
			});
			expect(r.ok, JSON.stringify(r.results)).toBe(true);
			expect((await readAccount(dbi, server, acc)).grants.global.grantOption).toBe(false);

			// revoke everything
			r = await updateGlobalPrivileges(dbi, server, caps, { ...base, privileges: [] });
			expect(r.ok, JSON.stringify(r.results)).toBe(true);
			expect((await readAccount(dbi, server, acc)).grants.global.privileges).toEqual([]);
		});

		it('manages dynamic / flavour specific privileges', async ({ skip }) => {
			if (!conn) return skip();
			const acc = track({ user: p('dyn'), host: '%' });
			await createAccount(dbi, server, caps, input(acc));
			const priv = server.isMariaDB ? 'BINLOG MONITOR' : 'SYSTEM_VARIABLES_ADMIN';
			const base = { account: acc, ssl: NO_SSL, limits: NO_LIMITS, grantOption: false };
			let r = await updateGlobalPrivileges(dbi, server, caps, {
				...base,
				privileges: ['SELECT', priv]
			});
			expect(r.ok, JSON.stringify(r.results)).toBe(true);
			expect((await readAccount(dbi, server, acc)).grants.global.privileges.sort()).toEqual(
				['SELECT', priv].sort()
			);
			r = await updateGlobalPrivileges(dbi, server, caps, { ...base, privileges: ['SELECT'] });
			expect(r.ok, JSON.stringify(r.results)).toBe(true);
			expect((await readAccount(dbi, server, acc)).grants.global.privileges).toEqual(['SELECT']);
		});

		it('changes resource limits and SSL requirement only where they differ', async ({ skip }) => {
			if (!conn) return skip();
			const acc = track({ user: p('lim'), host: '%' });
			await createAccount(
				dbi,
				server,
				caps,
				input(acc, { limits: { ...NO_LIMITS, maxQuestions: 5 } })
			);
			const base = { account: acc, privileges: [] as string[], grantOption: false };
			const plan = await planGlobalUpdate(dbi, server, {
				...base,
				ssl: { type: 'SPECIFIED', cipher: 'AES256-SHA', issuer: '', subject: '' },
				limits: { ...NO_LIMITS, maxQuestions: 5, maxUpdates: 9 }
			});
			expect(plan.map((s) => s.sql)).toEqual([
				`ALTER USER '${acc.user}'@'%' REQUIRE CIPHER 'AES256-SHA' WITH MAX_UPDATES_PER_HOUR 9`
			]);
			const r = await updateGlobalPrivileges(dbi, server, caps, {
				...base,
				ssl: { type: 'SPECIFIED', cipher: 'AES256-SHA', issuer: '', subject: '' },
				limits: { ...NO_LIMITS, maxQuestions: 5, maxUpdates: 9 }
			});
			expect(r.ok, JSON.stringify(r.results)).toBe(true);
			const props = await readAccountProperties(dbi, server, acc);
			expect(props.ssl).toMatchObject({ type: 'SPECIFIED', cipher: 'AES256-SHA' });
			expect(props.limits).toEqual({ ...NO_LIMITS, maxQuestions: 5, maxUpdates: 9 });
			// back to defaults
			const back = await updateGlobalPrivileges(dbi, server, caps, {
				...base,
				ssl: NO_SSL,
				limits: NO_LIMITS
			});
			expect(back.ok, JSON.stringify(back.results)).toBe(true);
			const props2 = await readAccountProperties(dbi, server, acc);
			expect(props2.ssl.type).toBe('NONE');
			expect(props2.limits).toEqual(NO_LIMITS);
		});

		it('REQUIRE SSL rejects a connection without SSL', async ({ skip }) => {
			if (!conn) return skip();
			const acc = track({ user: p('ssl'), host: '%' });
			const res = await createAccount(dbi, server, caps, input(acc, { ssl: { type: 'ANY' } }));
			expect(res.ok).toBe(true);
			await expect(login(acc.user, 'Pw-1!x')).rejects.toThrow(/Access denied/);
		});

		it('handles hostile user names', async ({ skip }) => {
			if (!conn) return skip();
			const acc = track({ user: p("q'x\\y"), host: "h%'" });
			const res = await createAccount(dbi, server, caps, input(acc, { privileges: ['SELECT'] }));
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			expect(await accountExists(dbi, acc)).toBe(true);
			const d = await readAccount(dbi, server, acc);
			expect(d.grants.global.privileges).toEqual(['SELECT']);
			const dropped = await dropAccounts(dbi, caps, { accounts: [acc], dropDatabases: false });
			expect(dropped.ok, JSON.stringify(dropped.results)).toBe(true);
			expect(await accountExists(dbi, acc)).toBe(false);
		});

		it('creates the same-name database, grants on it and drops both with the user', async ({
			skip
		}) => {
			if (!conn) return skip();
			const acc = track({ user: p('same'), host: '%' });
			const res = await createAccount(
				dbi,
				server,
				caps,
				input(acc, { databases: { createSameName: true, wildcard: true, database: databases[0] } })
			);
			// the database named databases[0] does not exist yet: GRANT on a missing db is allowed
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			expect(await dbi.databaseExists(acc.user)).toBe(true);
			const d = await readAccount(dbi, server, acc);
			expect(d.grants.databases.map((x) => x.db).sort()).toEqual(
				[
					acc.user.replaceAll('_', '\\_'),
					acc.user.replaceAll('_', '\\_') + '\\_%',
					databases[0]
				].sort()
			);
			const dropped = await dropAccounts(dbi, caps, { accounts: [acc], dropDatabases: true });
			expect(dropped.ok, JSON.stringify(dropped.results)).toBe(true);
			expect(await accountExists(dbi, acc)).toBe(false);
			expect(await dbi.databaseExists(acc.user)).toBe(false);
		});

		it('refuses to drop the connected account and system schema namesakes', async ({ skip }) => {
			if (!conn) return skip();
			const res = await dropAccounts(dbi, caps, {
				accounts: [caps.currentUser],
				dropDatabases: false
			});
			expect(res.ok).toBe(false);
			expect(res.results[0].error).toMatch(/logged in/);
			expect(await accountExists(dbi, caps.currentUser)).toBe(true);
			expect((await dropAccounts(dbi, caps, { accounts: [], dropDatabases: false })).error).toMatch(
				/No users selected/
			);
		});

		it('changes the password of the connected user and the new one logs in', async ({ skip }) => {
			if (!conn) return skip();
			const acc = track({ user: p('pw'), host: '%' });
			await createAccount(dbi, server, caps, input(acc, { password: 'old-Pw-1' }));
			const c = await createConnection(serverConfig(port), acc.user, 'old-Pw-1');
			try {
				const d2 = new DatabaseInterface(c, { only_db: '', hide_db: '', host: '127.0.0.1', port });
				const me = (await getCapabilities(d2)).currentUser;
				expect(me).toEqual(acc);
				const res = await changePassword(d2, server, { account: me, password: "new-Pw-2'" });
				expect(res.ok, JSON.stringify(res.results)).toBe(true);
				expect(res.results[0].statement).not.toContain('new-Pw-2');
			} finally {
				await c.end();
			}
			expect(await login(acc.user, "new-Pw-2'")).toBe(`${acc.user}@%`);
			await expect(login(acc.user, 'old-Pw-1')).rejects.toThrow(/Access denied/);
		});

		it('lists accounts with their global privilege summary and exports grants', async ({
			skip
		}) => {
			if (!conn) return skip();
			const acc = track({ user: p('list'), host: '%' });
			await createAccount(
				dbi,
				server,
				caps,
				input(acc, { privileges: ['SELECT', 'UPDATE'], grantOption: true })
			);
			const all = await withPrivilegeSummaries(dbi, server, await listAccounts(dbi, server));
			const mine = all.find((a) => a.user === acc.user && a.host === '%');
			expect(mine).toMatchObject({ inUserTable: true, hasPassword: true, hasGrant: true });
			expect(mine?.summary).toEqual({ kind: 'list', items: ['SELECT', 'UPDATE'], dynamic: [] });
			const root = all.find((a) => a.user === 'root' && a.host === '%');
			expect(root?.summary.kind).toBe('all');
			expect(root?.hasGrant).toBe(true);
			const text = await exportGrants(dbi, [acc, acc]);
			expect(text).toContain(`# Privileges for \`${acc.user}\`@\`%\``);
			expect(text).toContain('GRANT SELECT, UPDATE ON *.* TO');
			expect(text.match(/# Privileges for/g)).toHaveLength(1);
		});

		it('refuses non administrators', async ({ skip }) => {
			if (!conn) return skip();
			const acc = { user: p('denied'), host: '%' };
			const res = await createAccount(
				dbi,
				server,
				{ isCreateUser: false, isGrantUser: false },
				input(acc)
			);
			expect(res.ok).toBe(false);
			expect(await accountExists(dbi, acc)).toBe(false);
			expect(
				(
					await updateGlobalPrivileges(
						dbi,
						server,
						{ isGrantUser: false },
						{
							account: acc,
							privileges: [],
							grantOption: false,
							ssl: NO_SSL,
							limits: NO_LIMITS
						}
					)
				).ok
			).toBe(false);
		});

		it('an unprivileged user is neither create nor grant user', async ({ skip }) => {
			if (!conn) return skip();
			const acc = track({ user: p('plain'), host: '%' });
			await createAccount(dbi, server, caps, input(acc, { privileges: ['INSERT'] }));
			const c = await createConnection(serverConfig(port), acc.user, 'Pw-1!x');
			try {
				const d2 = new DatabaseInterface(c, { only_db: '', hide_db: '', host: '127.0.0.1', port });
				const k = await getCapabilities(d2);
				expect(k.isSuperUser).toBe(false);
				expect(k.isCreateUser).toBe(false);
				expect(k.isGrantUser).toBe(false);
			} finally {
				await c.end();
			}
		});
	});
}
