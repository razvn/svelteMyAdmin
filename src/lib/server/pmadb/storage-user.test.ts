import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Cookies } from '@sveltejs/kit';
import { afterAll, describe, expect, it } from 'vitest';
import { sessionInfo } from '#lib/server/auth/index.ts';
import { configSchema } from '#lib/server/config/schema.ts';
import { loadPrefs, savePrefs } from '#lib/server/preferences/store.ts';
import { closeAllSqlite } from '#lib/server/storage/sqlite/db.ts';
import { getHistory, recordHistory } from './history.ts';

const dir = mkdtempSync(join(tmpdir(), 'tmp_storage_user_'));
afterAll(() => {
	closeAllSqlite();
	rmSync(dir, { recursive: true, force: true });
});

const config = configSchema.parse({
	QueryHistoryDB: true,
	Servers: [
		{
			host: 'db',
			auth_type: 'signon',
			user: 'shared',
			password: 'pw',
			Signon: { identity: { type: 'trusted-header', trustedProxies: ['10.0.0.1'] } }
		}
	]
});
const server = { ...config.Servers[0], sqlite_storage: join(dir, 'storage.sqlite') };

/** A request on the signon server; `person` undefined = the shared account without an identity. */
function locals(person?: string): App.Locals {
	const creds = {
		serverIndex: 1,
		user: 'shared',
		password: 'pw',
		...(person ? { identity: { user: person, groups: [] } } : {})
	};
	return {
		config,
		server,
		serverIndex: 1,
		session: sessionInfo(server, creds),
		i18n: { t: (s: string) => s }
	} as unknown as App.Locals;
}

const noCookies = {
	get: () => undefined,
	set: () => {},
	delete: () => {}
} as unknown as Cookies;

describe('per-person configuration storage on one signon server', () => {
	it('keeps preferences per identity', async () => {
		expect(await savePrefs(locals('alice'), noCookies, { MaxRows: 50 }, false)).toBeNull();
		expect(await savePrefs(locals('bob'), noCookies, { MaxRows: 100 }, false)).toBeNull();

		expect(await loadPrefs(locals('alice'), noCookies)).toMatchObject({
			type: 'db',
			data: { MaxRows: 50 }
		});
		expect((await loadPrefs(locals('bob'), noCookies)).data).toEqual({ MaxRows: 100 });
		expect((await loadPrefs(locals(), noCookies)).data).toEqual({});
	});

	it('keeps query history per identity', async () => {
		await recordHistory(locals('alice'), [{ db: 'd', table: '', sqlquery: 'SELECT 1' }]);
		await recordHistory(locals('bob'), [{ db: 'd', table: '', sqlquery: 'SELECT 2' }]);

		expect((await getHistory(locals('alice'))).map((h) => h.sqlquery)).toEqual(['SELECT 1']);
		expect((await getHistory(locals('bob'))).map((h) => h.sqlquery)).toEqual(['SELECT 2']);
		expect(await getHistory(locals())).toEqual([]);
	});
});
