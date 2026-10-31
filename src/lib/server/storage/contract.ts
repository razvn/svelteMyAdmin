/**
 * Repository contract: the same behavioural suite runs against the SQLite backend (unit project,
 * always) and the MySQL backend (integration project, skipped when Docker is down). Both must
 * give the same answers; every test uses its own names so runs never interfere.
 */
import { describe, expect, it } from 'vitest';
import type { CentralColumn } from '#lib/sql/central-columns.ts';
import type { Repos } from './types.ts';

export interface ContractTarget {
	repos: Repos;
}

/** `make` returns null when the backend is unavailable (the tests are then skipped). */
export function defineRepoContract(label: string, make: () => Promise<ContractTarget | null>) {
	describe(`repository contract: ${label}`, () => {
		let target: ContractTarget | null | undefined;
		const need = async <K extends Exclude<keyof Repos, 'kind'>>(
			ctx: { skip: () => never },
			key: K
		): Promise<NonNullable<Repos[K]>> => {
			target ??= await make();
			if (!target) return ctx.skip();
			const repo = target.repos[key];
			if (!repo) throw new Error(`${String(key)} is not available`);
			return repo as NonNullable<Repos[K]>;
		};
		const uid = `u${Math.random().toString(36).slice(2, 8)}`;
		const db = `tmp_t11_c_${uid}`;

		it('bookmarks: own, shared, replace and delete', async (ctx) => {
			const r = await need(ctx, 'bookmarks');
			const a = `${uid}_a`;
			const b = `${uid}_b`;
			const own = await r.insert(a, {
				db,
				label: 'mine',
				query: 'SELECT 1',
				shared: false,
				replace: false
			});
			const shared = await r.insert(a, {
				db,
				label: 'all',
				query: 'SELECT 2',
				shared: true,
				replace: false
			});
			expect(own).toBeGreaterThan(0);
			expect((await r.list(a, db)).map((x) => x.label)).toEqual(['all', 'mine']);
			expect((await r.list(b, db)).map((x) => [x.label, x.shared])).toEqual([['all', true]]);
			expect(await r.get(b, db, own)).toBeNull();
			expect(await r.get(b, db, shared)).toMatchObject({ label: 'all', query: 'SELECT 2' });
			expect(await r.get(a, 'other_db', own)).toBeNull();

			const again = await r.insert(a, {
				db,
				label: 'mine',
				query: "SELECT 'x'",
				shared: false,
				replace: true
			});
			expect(await r.get(a, db, own)).toBeNull();
			expect((await r.get(a, db, again))?.query).toBe("SELECT 'x'");

			expect(await r.delete(b, own)).toBe(false);
			expect(await r.delete(a, again)).toBe(true);
			expect(await r.delete(b, shared)).toBe(true);
			expect(await r.list(a, db)).toEqual([]);
		});

		it('history: newest first, purge keeps the newest, clear', async (ctx) => {
			const r = await need(ctx, 'history');
			const user = `${uid}_h`;
			for (const q of ['SELECT 1', 'SELECT 2', 'SELECT 3']) {
				await r.insert({ username: user, db, table: 't', sqlquery: q });
			}
			const rows = await r.select(user, 10);
			expect(rows.map((x) => x.sqlquery)).toEqual(['SELECT 3', 'SELECT 2', 'SELECT 1']);
			expect(rows[0]).toMatchObject({ db, table: 't' });
			expect(rows[0].timevalue).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/);
			expect(await r.select(user, 2)).toHaveLength(2);
			expect(await r.purge(user, 2)).toBe(1);
			expect((await r.select(user, 10)).map((x) => x.sqlquery)).toEqual(['SELECT 3', 'SELECT 2']);
			expect(await r.purge(user, 5)).toBe(0);
			await r.clear(user);
			expect(await r.select(user, 10)).toEqual([]);
		});

		it('recent and favorite: replace and select', async (ctx) => {
			for (const key of ['recent', 'favorite'] as const) {
				const r = await need(ctx, key);
				const user = `${uid}_${key}`;
				expect(await r.select(user)).toEqual([]);
				await r.replace(user, [
					{ db: 'a', table: 'x' },
					{ db: 'b', table: 'y' }
				]);
				expect(await r.select(user)).toEqual([
					{ db: 'a', table: 'x' },
					{ db: 'b', table: 'y' }
				]);
				await r.replace(user, [{ db: 'c', table: 'z' }]);
				expect(await r.select(user)).toEqual([{ db: 'c', table: 'z' }]);
				expect(await r.select(`${user}_other`)).toEqual([]);
			}
		});

		it('userConfig: save, overwrite, delete', async (ctx) => {
			const r = await need(ctx, 'userConfig');
			const user = `${uid}_cfg`;
			expect(await r.load(user)).toBeNull();
			await r.save(user, { MaxRows: 50, 'Export/format': 'csv' });
			const first = await r.load(user);
			expect(first?.data).toEqual({ MaxRows: 50, 'Export/format': 'csv' });
			expect(first?.mtime).toBeGreaterThan(1_600_000_000);
			await r.save(user, { MaxRows: 100 });
			expect((await r.load(user))?.data).toEqual({ MaxRows: 100 });
			await r.save(user, {});
			expect((await r.load(user))?.data).toEqual({});
			await r.delete(user);
			expect(await r.load(user)).toBeNull();
		});

		it('navigationHiding: idempotent hide, unhide', async (ctx) => {
			const r = await need(ctx, 'navigationHiding');
			const user = `${uid}_nav`;
			await r.hide(user, db, { name: 't1', type: 'table' });
			await r.hide(user, db, { name: 't1', type: 'table' });
			await r.hide(user, db, { name: 'v1', type: 'view' });
			expect(await r.list(user, db)).toEqual([
				{ name: 't1', type: 'table' },
				{ name: 'v1', type: 'view' }
			]);
			expect(await r.list(user, 'other')).toEqual([]);
			await r.unhide(user, db, { name: 't1', type: 'table' });
			expect(await r.list(user, db)).toEqual([{ name: 'v1', type: 'view' }]);
			await r.unhide(user, db, { name: 'v1', type: 'view' });
		});

		it('userGroups: groups, members and denied tabs', async (ctx) => {
			const r = await need(ctx, 'userGroups');
			const g = `${uid}_grp`;
			const keys = ['server_sql', 'db_sql', 'table_sql'];
			expect(await r.groupExists(g)).toBe(false);
			await r.saveGroup(g, ['server_sql'], keys);
			expect(await r.groupExists(g)).toBe(true);
			expect(await r.getGroup(g)).toEqual({
				name: g,
				tabs: { server_sql: true, db_sql: false, table_sql: false }
			});
			await r.saveGroup(g, ['db_sql'], keys);
			expect((await r.getGroup(g))?.tabs).toEqual({
				server_sql: false,
				db_sql: true,
				table_sql: false
			});
			await r.setUserGroup(`${uid}_m1`, g);
			await r.setUserGroup(`${uid}_m2`, g);
			await r.setUserGroup(`${uid}_m2`, null);
			expect(await r.listGroupUsers(g)).toEqual([`${uid}_m1`]);
			expect((await r.listMemberships())[`${uid}_m1`]).toBe(g);
			expect((await r.listMemberships())[`${uid}_m2`]).toBeUndefined();
			expect((await r.deniedTabKeys(`${uid}_m1`)).sort()).toEqual(['server_sql', 'table_sql']);
			expect(await r.deniedTabKeys(`${uid}_nobody`)).toEqual([]);
			await r.deleteGroup(g);
			expect(await r.groupExists(g)).toBe(false);
			expect(await r.listGroupUsers(g)).toEqual([]);
		});

		it('centralColumns: add, list, filter, page, update, delete', async (ctx) => {
			const r = await need(ctx, 'centralColumns');
			const col = (name: string, over: Partial<CentralColumn> = {}): CentralColumn => ({
				name,
				type: 'varchar',
				length: '20',
				collation: 'utf8mb4_general_ci',
				isNull: false,
				extra: '',
				attribute: '',
				default: '',
				...over
			});
			const res = await r.add(db, [col('title'), col('id', { type: 'int', length: '10' })]);
			expect(res).toEqual({ added: ['title', 'id'], existing: [] });
			expect(await r.add(db, [col('id'), col('note', { isNull: true })])).toEqual({
				added: ['note'],
				existing: ['id']
			});
			expect((await r.list(db)).map((c) => c.name)).toEqual(['id', 'note', 'title']);
			expect(await r.count(db)).toBe(3);
			expect((await r.list(db, { pos: 1, num: 1 })).map((c) => c.name)).toEqual(['note']);
			expect((await r.list(db, { filter: 'itl' })).map((c) => c.name)).toEqual(['title']);
			expect(await r.count(db, 'itl')).toBe(1);
			expect(await r.count(db, '_')).toBe(0);
			expect((await r.list(db)).find((c) => c.name === 'note')?.isNull).toBe(true);
			await r.update(db, 'note', col('remark', { default: 'x' }));
			expect((await r.list(db)).find((c) => c.name === 'remark')).toMatchObject({
				type: 'varchar',
				default: 'x'
			});
			expect(await r.delete(db, ['remark', 'ghost'])).toEqual(['ghost']);
			expect(await r.delete(db, ['id', 'title'])).toEqual([]);
			expect(await r.count(db)).toBe(0);
		});

		it('tracking: versions, activity and log appends', async (ctx) => {
			const r = await need(ctx, 'tracking');
			const v = (version: number, table = 't') => ({
				db,
				table,
				version,
				created: '2026-01-01 10:00:00',
				updated: '2026-01-01 10:00:00',
				snapshot: 'snap',
				schemaSql: '# ddl\n',
				dataSql: '\n',
				tracking: 'UPDATE,INSERT,CREATE TABLE'
			});
			expect(await r.maxVersion(db, 't')).toBe(-1);
			expect(await r.anyActive(db)).toBe(false);
			await r.insert(v(1));
			await r.insert(v(2));
			await r.setActive(db, 't', 1, false);
			expect(await r.maxVersion(db, 't')).toBe(2);
			expect(await r.maxVersion(db, 't', 'INSERT')).toBe(2);
			expect(await r.maxVersion(db, 't', 'DELETE')).toBe(-1);
			expect(await r.maxVersion(db, 't', 'TABLE')).toBe(-1);
			expect(await r.isActive(db, 't')).toBe(true);
			expect(await r.anyActive(db)).toBe(true);

			await r.appendLog({
				db,
				table: 't',
				version: 2,
				which: 'dml',
				chunk: '\n# log\nINSERT 1;',
				updated: '2026-01-02 11:00:00',
				statement: 'INSERT'
			});
			// not tracked statement: untouched
			await r.appendLog({
				db,
				table: 't',
				version: 2,
				which: 'dml',
				chunk: 'NOPE',
				updated: '2026-01-03 11:00:00',
				statement: 'DELETE'
			});
			const row = await r.get(db, 't', 2);
			expect(row?.data_sql).toBe('\n\n# log\nINSERT 1;');
			expect(row?.tracking).toBe('UPDATE,INSERT,CREATE TABLE');
			expect(row?.schema_snapshot).toBe('snap');
			expect(await r.get(db, 't', 9)).toBeNull();

			await r.appendLog({
				db,
				table: 't',
				version: 2,
				which: 'ddl',
				chunk: '\nRENAME',
				updated: '2026-01-04 11:00:00',
				statement: 'CREATE TABLE',
				renameTo: 't2'
			});
			expect((await r.listVersions(db, 't2')).map((x) => [x.version, x.active, x.updated])).toEqual(
				[[2, true, '2026-01-04 11:00:00']]
			);
			await r.saveLog(db, 't2', 2, 'ddl', 'replaced');
			expect((await r.get(db, 't2', 2))?.schema_sql).toBe('replaced');

			await r.insert(v(1, 'other'));
			await r.insert({ ...v(1, ''), snapshot: '' });
			expect((await r.listTracked(db)).map((x) => [x.table, x.version])).toEqual([
				['other', 1],
				['t', 1],
				['t2', 2]
			]);
			await r.delete(db, 't', 1);
			expect(await r.listVersions(db, 't')).toEqual([]);
			await r.delete(db, 't2');
			await r.delete(db, 'other');
			await r.delete(db, '');
			expect(await r.listTracked(db)).toEqual([]);
			expect(await r.anyActive(db)).toBe(false);
		});

		it('designer: pages, positions and settings', async (ctx) => {
			const pages = await need(ctx, 'designerPages');
			const first = await pages.createPage(db, 'Zeta');
			const second = await pages.createPage(db, 'Alpha');
			expect(second).toBeGreaterThan(first);
			expect(await pages.listPages(db)).toEqual([
				{ id: second, name: 'Alpha' },
				{ id: first, name: 'Zeta' }
			]);
			expect(await pages.pageExists(db, first)).toBe(true);
			expect(await pages.pageExists('other', first)).toBe(false);
			await pages.renamePage(db, first, 'Beta');
			expect((await pages.listPages(db)).map((p) => p.name)).toEqual(['Alpha', 'Beta']);
			await pages.savePositions(db, first, { a: { x: 10, y: 20 }, b: { x: -5, y: 3.5 } });
			expect(await pages.loadPositions(db, first)).toEqual({
				a: { x: 10, y: 20 },
				b: { x: 0, y: 3.5 }
			});
			await pages.savePositions(db, first, { c: { x: 1, y: 2 } });
			expect(await pages.loadPositions(db, first)).toEqual({ c: { x: 1, y: 2 } });
			await pages.deletePage(db, first);
			await pages.deletePage(db, second);
			expect(await pages.loadPositions(db, first)).toEqual({});
			expect(await pages.listPages(db)).toEqual([]);

			const settings = await need(ctx, 'designerSettings');
			const user = `${uid}_ds`;
			expect(await settings.get(user)).toBeNull();
			await settings.set(user, '{"snap_to_grid":"on"}');
			await settings.set(user, '{"snap_to_grid":"off"}');
			expect(await settings.get(user)).toBe('{"snap_to_grid":"off"}');
		});

		it('relation, table info and column info follow table moves and copies', async (ctx) => {
			const rel = await need(ctx, 'relation');
			const info = await need(ctx, 'tableInfo');
			const cols = await need(ctx, 'columnInfo');

			await rel.set(db, 'books', 'author_id', { db, table: 'authors', column: 'id' });
			await rel.set(db, 'books', 'author_id', { db, table: 'writers', column: 'id' });
			await rel.set(db, 'books', 'editor_id', { db: 'elsewhere', table: 'people', column: 'id' });
			expect(await rel.listForTable(db, 'books')).toEqual([
				{ column: 'author_id', refDb: db, refTable: 'writers', refColumn: 'id' },
				{ column: 'editor_id', refDb: 'elsewhere', refTable: 'people', refColumn: 'id' }
			]);
			expect((await rel.listForDb(db)).map((x) => x.masterTable)).toEqual(['books', 'books']);
			expect(await rel.listForDb('nope')).toEqual([]);

			await info.set(db, 'writers', 'name');
			await info.set(db, 'writers', 'surname');
			expect(await info.get(db, 'writers')).toBe('surname');
			expect(await info.listForDb(db)).toEqual([{ table: 'writers', displayField: 'surname' }]);

			await cols.saveMime(db, 'books', [
				{
					column: 'cover',
					row: {
						mimetype: 'image/jpeg',
						transformation: 'image_jpeg_inline.php',
						transformation_options: '100',
						input_transformation: '',
						input_transformation_options: ''
					}
				}
			]);
			expect(await cols.loadMime(db, 'books')).toEqual([
				{
					column: 'cover',
					mimetype: 'image/jpeg',
					transformation: 'image_jpeg_inline.php',
					transformation_options: '100',
					input_transformation: '',
					input_transformation_options: ''
				}
			]);
			await cols.setDbComment(db, "it's a db");
			expect(await cols.getDbComment(db)).toBe("it's a db");

			// copy a table: the metadata of the source stays, the copy gets its own
			await rel.transferTable({ db, table: 'books' }, { db, table: 'books2' }, false);
			await info.transferTable({ db, table: 'writers' }, { db, table: 'writers2' }, false);
			await cols.transferTable({ db, table: 'books' }, { db, table: 'books2' }, false);
			expect((await rel.listForTable(db, 'books2')).map((x) => x.column)).toEqual([
				'author_id',
				'editor_id'
			]);
			expect(await info.get(db, 'writers2')).toBe('surname');
			expect((await cols.loadMime(db, 'books2')).map((x) => x.column)).toEqual(['cover']);
			expect((await rel.listForTable(db, 'books')).length).toBe(2);

			// rename a table: its own rows and the rows pointing to it follow
			await rel.transferTable({ db, table: 'writers' }, { db, table: 'authors' }, true);
			await rel.transferTable({ db, table: 'books2' }, { db, table: 'tomes' }, true);
			expect(
				(await rel.listForTable(db, 'books')).find((x) => x.column === 'author_id')?.refTable
			).toBe('authors');
			expect((await rel.listForTable(db, 'books2')).length).toBe(0);
			expect((await rel.listForTable(db, 'tomes')).length).toBe(2);
			await info.transferTable({ db, table: 'writers' }, { db, table: 'authors' }, true);
			expect(await info.get(db, 'authors')).toBe('surname');
			expect(await info.get(db, 'writers')).toBe('');
			await cols.transferTable({ db, table: 'books' }, { db, table: 'volumes' }, true);
			expect((await cols.loadMime(db, 'volumes')).map((x) => x.column)).toEqual(['cover']);

			// column rename in the same save, and a row with nothing left is removed
			await cols.saveMime(db, 'volumes', [
				{
					column: 'picture',
					oldName: 'cover',
					row: {
						mimetype: 'image/png',
						transformation: '',
						transformation_options: '',
						input_transformation: '',
						input_transformation_options: ''
					}
				}
			]);
			expect((await cols.loadMime(db, 'volumes')).map((x) => [x.column, x.mimetype])).toEqual([
				['picture', 'image/png']
			]);
			await cols.saveMime(db, 'volumes', [
				{
					column: 'picture',
					row: {
						mimetype: '',
						transformation: '',
						transformation_options: '',
						input_transformation: '',
						input_transformation_options: ''
					}
				}
			]);
			expect(await cols.loadMime(db, 'volumes')).toEqual([]);

			// database level: comments and column info follow a copy / rename of the database
			await cols.saveMime(db, 'tomes', [
				{
					column: 'c',
					row: {
						mimetype: 'text/plain',
						transformation: '',
						transformation_options: '',
						input_transformation: '',
						input_transformation_options: ''
					}
				}
			]);
			const copy = `${db}_copy`;
			await cols.transferDb(db, copy, false);
			expect(await cols.getDbComment(copy)).toBe("it's a db");
			expect((await cols.listForDb(copy)).map((x) => [x.table, x.column])).toContainEqual([
				'tomes',
				'c'
			]);
			const moved = `${db}_moved`;
			await cols.transferDb(copy, moved, true);
			expect(await cols.getDbComment(copy)).toBe('');
			expect(await cols.getDbComment(moved)).toBe("it's a db");
			await cols.setDbComment(moved, '');
			await cols.setDbComment(db, '');
			expect(await cols.getDbComment(db)).toBe('');

			// clean up
			for (const t of ['books', 'books2', 'tomes']) {
				for (const x of await rel.listForTable(db, t)) await rel.set(db, t, x.column, null);
			}
			await info.set(db, 'authors', '');
			await info.set(db, 'writers2', '');
			for (const [d, t] of [
				[db, 'tomes'],
				[db, 'volumes'],
				[moved, 'tomes']
			]) {
				const rows = await cols.loadMime(d, t);
				await cols.saveMime(
					d,
					t,
					rows.map((x) => ({
						column: x.column,
						row: {
							mimetype: '',
							transformation: '',
							transformation_options: '',
							input_transformation: '',
							input_transformation_options: ''
						}
					}))
				);
			}
		});

		it('savedSearches: unique names, update, delete', async (ctx) => {
			const r = await need(ctx, 'savedSearches');
			const user = `${uid}_ss`;
			const id = await r.insert(user, db, 'by name', '{"a":1}');
			await expect(r.insert(user, db, 'by name', '{}')).rejects.toBeDefined();
			expect(await r.list(user, db)).toEqual([{ id, name: 'by name', data: '{"a":1}' }]);
			expect(await r.list(`${user}x`, db)).toEqual([]);
			expect(await r.update(id, user, db, 'renamed', '{"a":2}')).toBe(1);
			expect(await r.update(id, `${user}x`, db, 'nope', '{}')).toBe(0);
			expect((await r.list(user, db))[0]).toMatchObject({ name: 'renamed', data: '{"a":2}' });
			expect(await r.delete(id, `${user}x`, db)).toBe(0);
			expect(await r.delete(id, user, db)).toBe(1);
		});

		it('tableUiPrefs: upsert per user and table', async (ctx) => {
			const r = await need(ctx, 'tableUiPrefs');
			const user = `${uid}_ui`;
			expect(await r.get(user, db, 't')).toBeNull();
			await r.set(user, db, 't', '{"sorted_col":"id"}');
			await r.set(user, db, 't', '{"sorted_col":"name"}');
			await r.set(user, db, 'u', '{"max_rows":50}');
			expect(await r.get(user, db, 't')).toBe('{"sorted_col":"name"}');
			expect(await r.get(user, db, 'u')).toBe('{"max_rows":50}');
			expect(await r.get(`${user}x`, db, 't')).toBeNull();
		});

		it('exportTemplates: per user and type, unique names', async (ctx) => {
			const r = await need(ctx, 'exportTemplates');
			const user = `${uid}_et`;
			const a = await r.create(user, 'table', 'b-tpl', '{"what":"sql"}');
			const b = await r.create(user, 'table', 'a-tpl', '{"what":"csv"}');
			await expect(r.create(user, 'table', 'a-tpl', '{}')).rejects.toBeDefined();
			await r.create(user, 'server', 'a-tpl', '{}');
			expect((await r.list(user, 'table')).map((x) => x.name)).toEqual(['a-tpl', 'b-tpl']);
			expect(await r.get(a, user)).toBe('{"what":"sql"}');
			expect(await r.get(a, `${user}x`)).toBeNull();
			expect(await r.update(a, user, '{"what":"json"}')).toBe(true);
			expect(await r.update(a, `${user}x`, '{}')).toBe(false);
			expect(await r.get(a, user)).toBe('{"what":"json"}');
			expect(await r.delete(a, `${user}x`)).toBe(false);
			expect(await r.delete(a, user)).toBe(true);
			expect(await r.delete(b, user)).toBe(true);
			for (const x of await r.list(user, 'server')) await r.delete(x.id, user);
		});

		it('ping answers for every available repository', async (ctx) => {
			await need(ctx, 'bookmarks');
			for (const [key, repo] of Object.entries(target!.repos)) {
				if (key === 'kind' || repo === null) continue;
				expect(await (repo as { ping(): Promise<boolean> }).ping(), key).toBe(true);
			}
		});
	});
}
