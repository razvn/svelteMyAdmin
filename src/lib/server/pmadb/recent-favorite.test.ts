import { describe, expect, it } from 'vitest';
import { getTableList, recordRecent, toggleFavorite } from './recent-favorite.ts';

/** No `pmadb`: the lists live in server memory per login (phpMyAdmin's session fallback). */
function locals(user: string, recent = 2, favorite = 2): App.Locals {
	return {
		server: { pmadb: '' },
		config: { NumRecentTables: recent, NumFavoriteTables: favorite },
		serverIndex: 1,
		session: { user, host: 'h', port: 0 }
	} as unknown as App.Locals;
}

describe('recent / favorite without configuration storage', () => {
	it('records visits newest first, deduplicated and capped by NumRecentTables', async () => {
		const l = locals('recent-user');
		await recordRecent(l, { db: 'd', table: 'a' });
		await recordRecent(l, { db: 'd', table: 'b' });
		await recordRecent(l, { db: 'd', table: 'a' });
		await recordRecent(l, { db: 'd', table: 'c' });
		const { tables, persistent } = await getTableList(l, 'recent');
		expect(persistent).toBe(false);
		expect(tables).toEqual([
			{ db: 'd', table: 'c' },
			{ db: 'd', table: 'a' }
		]);
	});

	it('keeps lists per user', async () => {
		await recordRecent(locals('u1'), { db: 'd', table: 'x' });
		expect((await getTableList(locals('u2'), 'recent')).tables).toEqual([]);
	});

	it('toggles favorites and refuses to exceed NumFavoriteTables', async () => {
		const l = locals('fav-user', 2, 2);
		expect(await toggleFavorite(l, { db: 'd', table: 'a' })).toBe('added');
		expect(await toggleFavorite(l, { db: 'd', table: 'b' })).toBe('added');
		expect(await toggleFavorite(l, { db: 'd', table: 'c' })).toBe('full');
		expect((await getTableList(l, 'favorite')).tables.map((t) => t.table)).toEqual(['b', 'a']);
		expect(await toggleFavorite(l, { db: 'd', table: 'a' })).toBe('removed');
		expect(await toggleFavorite(l, { db: 'd', table: 'c' })).toBe('added');
		expect((await getTableList(l, 'favorite')).tables.map((t) => t.table)).toEqual(['c', 'b']);
	});
});
