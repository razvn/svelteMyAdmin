import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '../db/connection.ts';
import { allTabKeys } from '../../nav/user-groups.ts';
import {
	deleteGroup,
	getDeniedTabKeys,
	getGroup,
	groupExists,
	groupTables,
	listGroups,
	listGroupUsers,
	listMemberships,
	saveGroup,
	setUserGroup
} from './user-groups.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

for (const { name, port } of servers) {
	describe(`user groups in the configuration storage against ${name}`, () => {
		let conn: Connection | undefined;
		const t = groupTables({
			pmadb: 'phpmyadmin',
			users: 'pma__users',
			usergroups: 'pma__usergroups'
		})!;
		const g1 = `tmp_t7c_int_${port}_a`;
		const g2 = `tmp_t7c_int_${port}_b`;
		const u1 = `tmp_t7c_int_${port}_u1`;
		const u2 = `tmp_t7c_int_${port}_u2`;

		const cleanup = async () => {
			if (!conn) return;
			await conn.query(`DELETE FROM ${t.groups} WHERE usergroup IN (?, ?)`, [g1, g2]);
			await conn.query(`DELETE FROM ${t.users} WHERE username IN (?, ?)`, [u1, u2]);
		};

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
				await conn.query(`SELECT 1 FROM ${t.groups} LIMIT 1`);
				await conn.query(`SELECT 1 FROM ${t.users} LIMIT 1`);
				await cleanup();
			} catch {
				conn = undefined;
				console.warn(`[integration] ${name} or its pmadb unreachable, skipping`);
			}
		});
		afterAll(async () => {
			await cleanup();
			await conn?.end();
		});

		it('is only enabled when both tables are configured', () => {
			expect(groupTables({ pmadb: '', users: 'a', usergroups: 'b' })).toBeNull();
			expect(groupTables({ pmadb: 'x', users: 'a', usergroups: '' })).toBeNull();
		});

		it('creates, reads, edits and deletes a group', async (ctx) => {
			if (!conn) return ctx.skip();
			const allowed = ['server_databases', 'server_sql', 'db_structure'];
			await saveGroup(conn, t, g1, allowed);
			expect(await groupExists(conn, t, g1)).toBe(true);
			const group = await getGroup(conn, t, g1);
			expect(Object.keys(group!.tabs).sort()).toEqual(allTabKeys().sort());
			expect(
				Object.entries(group!.tabs)
					.filter(([, v]) => v)
					.map(([k]) => k)
					.sort()
			).toEqual([...allowed].sort());

			await saveGroup(conn, t, g1, ['table_browse']);
			const edited = await getGroup(conn, t, g1);
			expect(
				Object.entries(edited!.tabs)
					.filter(([, v]) => v)
					.map(([k]) => k)
			).toEqual(['table_browse']);
			expect((await listGroups(conn, t)).filter((g) => g.name === g1)).toHaveLength(1);

			await deleteGroup(conn, t, g1);
			expect(await groupExists(conn, t, g1)).toBe(false);
		});

		it('manages membership and the denied tab keys', async (ctx) => {
			if (!conn) return ctx.skip();
			await saveGroup(conn, t, g1, ['server_databases', 'server_sql', 'db_structure']);
			await saveGroup(conn, t, g2, allTabKeys());

			expect(await getDeniedTabKeys(conn, t, u1)).toEqual([]);
			await setUserGroup(conn, t, u1, g1);
			await setUserGroup(conn, t, u2, g2);
			const denied = await getDeniedTabKeys(conn, t, u1);
			expect(denied).toContain('server_status');
			expect(denied).toContain('server_rights');
			expect(denied).not.toContain('server_sql');
			expect(denied).not.toContain('db_structure');
			expect(await getDeniedTabKeys(conn, t, u2)).toEqual([]);

			const memberships = await listMemberships(conn, t);
			expect(memberships[u1]).toBe(g1);
			expect(await listGroupUsers(conn, t, g1)).toEqual([u1]);

			// moving a user replaces the assignment; none removes it
			await setUserGroup(conn, t, u1, g2);
			expect((await listMemberships(conn, t))[u1]).toBe(g2);
			await setUserGroup(conn, t, u1, null);
			expect((await listMemberships(conn, t))[u1]).toBeUndefined();

			// deleting a group drops its memberships
			await deleteGroup(conn, t, g2);
			expect(await listGroupUsers(conn, t, g2)).toEqual([]);
			expect((await listMemberships(conn, t))[u2]).toBeUndefined();
		});
	});
}
