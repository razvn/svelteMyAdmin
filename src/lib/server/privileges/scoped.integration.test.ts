import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '../db/connection';
import { DatabaseInterface } from '../db/dbi';
import {
	changeLogin,
	createAccount,
	createRole,
	dropRoles,
	getCapabilities,
	getPrivServer,
	grantRoleTo,
	listGrantedRoles,
	listRoles,
	listUsersWithAccess,
	listAccounts,
	readAccount,
	resolveAccount,
	revokeRoleFrom,
	revokeScoped,
	setDefaultRoles,
	updateScopedPrivileges,
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
	describe(`scoped privileges, login change and roles against ${name}`, () => {
		let conn: Connection | undefined;
		let dbi: DatabaseInterface;
		let server: PrivServer;
		let caps: Capabilities;
		const p = (s: string) => `tmp_t7b_${s}_${port}`;
		const db = p('db');
		const created: Account[] = [];
		const roleNames: string[] = [];
		const track = (a: Account) => {
			created.push(a);
			return a;
		};
		const mk = async (account: Account, privileges: string[] = []) => {
			const res = await createAccount(dbi, server, caps, {
				account,
				password: 'Pw-1!x',
				privileges,
				grantOption: false,
				ssl: NO_SSL,
				limits: NO_LIMITS,
				databases: {}
			});
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			return account;
		};

		beforeAll(async () => {
			try {
				conn = await createConnection(serverConfig(port), 'root', 'root');
				dbi = new DatabaseInterface(conn, { only_db: '', hide_db: '', host: '127.0.0.1', port });
				const [old] = await conn.query(
					"SELECT User, Host FROM mysql.user WHERE User LIKE 'tmp\\_t7b\\_%'"
				);
				for (const u of old as { User: string; Host: string }[]) {
					const acc = { user: u.User, host: u.Host };
					const isRole = port === 33307 && u.Host === '';
					await conn.query(
						isRole
							? `DROP ROLE IF EXISTS \`${u.User}\``
							: `DROP USER IF EXISTS ${quoteAccount(acc)}`
					);
				}
				await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
				await conn.query(`DROP DATABASE IF EXISTS \`${db}2\``);
				await conn.query(`CREATE DATABASE \`${db}\``);
				await conn.query(`CREATE TABLE \`${db}\`.t (a INT, b INT, c INT)`);
				await conn.query(`CREATE TABLE \`${db}\`.t2 (a INT)`);
				await conn.query(`CREATE PROCEDURE \`${db}\`.proc() SELECT 1`);
				server = await getPrivServer(dbi);
				caps = await getCapabilities(dbi);
			} catch {
				conn = undefined;
				console.warn(`[integration] ${name} unreachable on 127.0.0.1:${port}, skipping`);
			}
		});
		afterAll(async () => {
			if (!conn) return;
			for (const a of created) await conn.query(`DROP USER IF EXISTS ${quoteAccount(a)}`);
			for (const r of roleNames) {
				await conn.query(
					server.isMariaDB ? `DROP ROLE IF EXISTS \`${r}\`` : `DROP ROLE IF EXISTS '${r}'@'%'`
				);
			}
			await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
			await conn.end();
		});

		it('grants, diffs and revokes database privileges including a wildcard database', async ({
			skip
		}) => {
			if (!conn) return skip();
			const acc = track(await mk({ user: p('dbu'), host: '%' }));
			const target = { scope: 'database', db: `${p('db').replace(/_/g, '\\_')}` } as const;
			let res = await updateScopedPrivileges(dbi, server, caps, [
				{ account: acc, target, privileges: ['SELECT', 'INSERT'], grantOption: true }
			]);
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			let d = await readAccount(dbi, server, acc);
			expect(d.grants.databases).toHaveLength(1);
			expect(d.grants.databases[0].privileges.sort()).toEqual(['INSERT', 'SELECT']);
			expect(d.grants.databases[0].grantOption).toBe(true);

			// diff: drop INSERT and grant option, add UPDATE
			res = await updateScopedPrivileges(dbi, server, caps, [
				{ account: acc, target, privileges: ['SELECT', 'UPDATE'], grantOption: false }
			]);
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			d = await readAccount(dbi, server, acc);
			expect(d.grants.databases[0].privileges.sort()).toEqual(['SELECT', 'UPDATE']);
			expect(d.grants.databases[0].grantOption).toBe(false);

			// wildcard pattern
			const wild = { scope: 'database', db: 'tmp\\_t7b\\_wild%' } as const;
			res = await updateScopedPrivileges(dbi, server, caps, [
				{ account: acc, target: wild, privileges: ['SELECT'], grantOption: false }
			]);
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			d = await readAccount(dbi, server, acc);
			expect(d.grants.databases.map((x) => x.db).sort()).toEqual([wild.db, target.db].sort());

			// listing: users with access to the db
			const rows = await listUsersWithAccess(dbi, server, db);
			const mine = rows.find((r) => r.user === acc.user);
			expect(mine?.entries.map((e) => e.type)).toEqual(['database-specific']);

			res = await revokeScoped(dbi, server, caps, acc, target);
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			d = await readAccount(dbi, server, acc);
			expect(d.grants.databases.map((x) => x.db)).toEqual([wild.db]);
			expect((await revokeScoped(dbi, server, caps, acc, wild)).ok).toBe(true);
			d = await readAccount(dbi, server, acc);
			expect(d.grants.databases).toHaveLength(0);
		});

		it('grants table, column and routine privileges and lists them for the table', async ({
			skip
		}) => {
			if (!conn) return skip();
			const acc = track(await mk({ user: p('tbl'), host: '%' }));
			const target = { scope: 'table', db, table: 't' } as const;
			let res = await updateScopedPrivileges(dbi, server, caps, [
				{
					account: acc,
					target,
					privileges: ['DELETE'],
					grantOption: false,
					columns: { SELECT: ['a', 'b'], UPDATE: ['c'] }
				}
			]);
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			let d = await readAccount(dbi, server, acc);
			expect(d.grants.tables).toHaveLength(1);
			expect(d.grants.tables[0].privileges).toEqual(['DELETE']);
			const cols = Object.fromEntries(
				d.grants.tables[0].columns.map((c) => [c.privilege, c.columns.sort()])
			);
			expect(cols).toEqual({ SELECT: ['a', 'b'], UPDATE: ['c'] });

			// change columns: SELECT only a, drop UPDATE, add REFERENCES b
			res = await updateScopedPrivileges(dbi, server, caps, [
				{
					account: acc,
					target,
					privileges: ['DELETE'],
					grantOption: false,
					columns: { SELECT: ['a'], REFERENCES: ['b'] }
				}
			]);
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			d = await readAccount(dbi, server, acc);
			const cols2 = Object.fromEntries(
				d.grants.tables[0].columns.map((c) => [c.privilege, c.columns.sort()])
			);
			expect(cols2).toEqual({ SELECT: ['a'], REFERENCES: ['b'] });

			// routine
			const routine = { scope: 'routine', db, routine: 'proc', type: 'PROCEDURE' } as const;
			res = await updateScopedPrivileges(dbi, server, caps, [
				{
					account: acc,
					target: routine,
					privileges: ['EXECUTE', 'ALTER ROUTINE'],
					grantOption: true
				}
			]);
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			d = await readAccount(dbi, server, acc);
			expect(d.grants.routines[0].privileges.sort()).toEqual(['ALTER ROUTINE', 'EXECUTE']);
			expect(d.grants.routines[0].grantOption).toBe(true);

			// listing for table t and for t2
			const forT = (await listUsersWithAccess(dbi, server, db, 't')).find(
				(r) => r.user === acc.user
			);
			expect(forT?.entries.map((e) => e.type)).toEqual(['table-specific', 'routine']);
			const forT2 = (await listUsersWithAccess(dbi, server, db, 't2')).find(
				(r) => r.user === acc.user
			);
			expect(forT2?.entries.map((e) => e.type)).toEqual(['routine']);

			// revoke table removes table and column grants
			res = await revokeScoped(dbi, server, caps, acc, target);
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			d = await readAccount(dbi, server, acc);
			expect(d.grants.tables).toHaveLength(0);
		});

		const richAccount = async (user: string, host: string) => {
			const acc = track(await mk({ user, host }, ['SELECT']));
			const res = await updateScopedPrivileges(dbi, server, caps, [
				{
					account: acc,
					target: { scope: 'database', db: 'tmp\\_t7b\\_x%' },
					privileges: ['SELECT', 'INSERT'],
					grantOption: true
				},
				{
					account: acc,
					target: { scope: 'table', db, table: 't' },
					privileges: ['DELETE'],
					grantOption: false,
					columns: { SELECT: ['a', 'b'] }
				},
				{
					account: acc,
					target: { scope: 'routine', db, routine: 'proc', type: 'PROCEDURE' },
					privileges: ['EXECUTE'],
					grantOption: false
				}
			]);
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			return acc;
		};
		const shape = async (a: Account) => {
			const d = await readAccount(dbi, server, a);
			const g = d.grants;
			return JSON.stringify({
				global: g.global.privileges.slice().sort(),
				databases: g.databases,
				tables: g.tables,
				routines: g.routines
			});
		};

		it('copy mode 4 keeps the old account and preserves every grant level and the password', async ({
			skip
		}) => {
			if (!conn) return skip();
			const old = await richAccount(p('cp4'), '%');
			const to = track({ user: p('cp4n'), host: '%' });
			const res = await changeLogin(dbi, server, caps, { from: old, to, mode: 4 });
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			expect(await shape(to)).toBe(await shape(old));
			expect((await listAccounts(dbi, server)).some((a) => a.user === old.user)).toBe(true);
			// same password
			const c = await createConnection(serverConfig(port), to.user, 'Pw-1!x');
			await c.end();
			// same name is rejected
			const dup = await changeLogin(dbi, server, caps, { from: old, to, mode: 4 });
			expect(dup.ok).toBe(false);
		});

		it('modes 1, 2 and 3 move the account and delete the old one', async ({ skip }) => {
			if (!conn) return skip();
			for (const mode of [1, 2, 3] as const) {
				const old = await richAccount(p(`mv${mode}`), '%');
				const before = await shape(old);
				const to = track({ user: p(`mv${mode}n`), host: '%' });
				const res = await changeLogin(dbi, server, caps, { from: old, to, mode });
				expect(res.ok, `${mode} ${JSON.stringify(res.results)}`).toBe(true);
				expect(await shape(to)).toBe(before);
				const names = (await listAccounts(dbi, server)).map((a) => a.user);
				expect(names).not.toContain(old.user);
				const c = await createConnection(serverConfig(port), to.user, 'Pw-1!x');
				await c.end();
			}
		});

		it('rejects an unchanged login', async ({ skip }) => {
			if (!conn) return skip();
			const a = track(await mk({ user: p('same'), host: '%' }));
			const res = await changeLogin(dbi, server, caps, { from: a, to: a, mode: 4 });
			expect(res.ok).toBe(false);
			expect(res.error).toMatch(/didn't change/);
		});

		it('creates, grants, defaults, revokes and drops a role', async ({ skip }) => {
			if (!conn) return skip();
			const role = p('role');
			roleNames.push(role);
			const user = track(await mk({ user: p('member'), host: '%' }));
			let res = await createRole(dbi, server, caps, role);
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			expect((await createRole(dbi, server, caps, role)).ok).toBe(false);

			let roles = await listRoles(dbi, server);
			expect(roles.find((r) => r.name === role)).toBeDefined();
			const baseline = roles.find((r) => r.name === role)!.members;
			// the role is not listed as a normal account elsewhere
			expect((await listAccounts(dbi, server)).find((a) => a.user === role)?.isRole).toBe(true);

			// the role's own privileges via the normal editor
			const roleAcc = resolveAccount(server, {
				user: role,
				host: server.isMariaDB ? '' : '%'
			});
			res = await updateScopedPrivileges(dbi, server, caps, [
				{
					account: roleAcc,
					target: { scope: 'database', db },
					privileges: ['SELECT'],
					grantOption: false
				}
			]);
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			expect((await readAccount(dbi, server, roleAcc)).grants.databases[0].privileges).toEqual([
				'SELECT'
			]);

			res = await grantRoleTo(dbi, server, caps, { role, to: user, adminOption: true });
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			roles = await listRoles(dbi, server);
			expect(roles.find((r) => r.name === role)?.members).toBe(baseline + 1);
			let granted = await listGrantedRoles(dbi, server, user);
			expect(granted).toHaveLength(1);
			expect(granted[0]).toMatchObject({ role, adminOption: true, isDefault: false });

			res = await setDefaultRoles(dbi, server, caps, {
				account: user,
				roles: [{ role, host: granted[0].host }]
			});
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			granted = await listGrantedRoles(dbi, server, user);
			expect(granted[0].isDefault).toBe(true);
			res = await setDefaultRoles(dbi, server, caps, { account: user, roles: [] });
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			expect((await listGrantedRoles(dbi, server, user))[0].isDefault).toBe(false);

			res = await revokeRoleFrom(dbi, server, caps, { role, from: user });
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			expect(await listGrantedRoles(dbi, server, user)).toHaveLength(0);

			res = await dropRoles(dbi, server, caps, [{ name: role, host: server.isMariaDB ? '' : '%' }]);
			expect(res.ok, JSON.stringify(res.results)).toBe(true);
			expect((await listRoles(dbi, server)).some((r) => r.name === role)).toBe(false);
		});
	});
}
