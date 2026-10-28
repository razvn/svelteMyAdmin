import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '../db/connection';
import { DatabaseInterface } from '../db/dbi';
import { newIndexDef, type IndexDef } from '#lib/sql/index-definition.ts';
import { newFkDef } from '#lib/sql/foreign-key.ts';
import { newColumn, buildColumnSpec, type ColumnDef } from '#lib/sql/column-definition.ts';
import {
	addColumns,
	addKey,
	changeColumns,
	dropColumns,
	dropIndex,
	getCaps,
	loadColumns,
	loadIndexes,
	loadPartitions,
	loadStats,
	moveColumns,
	renameIndex,
	saveIndex
} from './structure';
import {
	detectStorage,
	dropForeignKey,
	loadDisplayField,
	loadForeignKeys,
	loadInternalRelations,
	saveDisplayField,
	saveForeignKey,
	saveInternalRelation,
	type RelationServer
} from './relation';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

const def = (o: Partial<ColumnDef>) => newColumn(o);
const idx = (o: Partial<IndexDef>): IndexDef => newIndexDef(o);
const cols = (...n: string[]) => n.map((name) => ({ name, size: '' }));

for (const { name, port } of servers) {
	describe(`table structure against ${name}`, () => {
		let conn: Connection | undefined;
		let dbi: DatabaseInterface;
		const db = `tmp_t4b_int_${port}`;
		const ctx = (table: string) => ({ dbi, db, table });
		const q = async (sql: string) => {
			await conn!.query(sql);
		};
		const names = async (table: string) =>
			(await loadColumns(dbi, db, table, await getCaps(dbi))).map((c) => c.def.name);

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
				dbi = new DatabaseInterface(conn, { only_db: '', hide_db: '', host: '127.0.0.1', port });
				await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
				await conn.query(`CREATE DATABASE \`${db}\``);
				await conn.query(`USE \`${db}\``);
			} catch {
				conn = undefined;
				console.warn(`[integration] ${name} unreachable on 127.0.0.1:${port}, skipping`);
			}
		});
		afterAll(async () => {
			await conn?.query(`DROP DATABASE IF EXISTS \`${db}\``);
			await conn?.end();
		});

		it('adds columns at the end, at the beginning and after a column', async (c) => {
			if (!conn) return c.skip();
			await q('CREATE TABLE `cols` (`a` INT NOT NULL, `b` INT NOT NULL)');
			let r = await addColumns(ctx('cols'), {
				columns: [def({ name: 'z', type: 'VARCHAR', length: '10', null: true })],
				placement: { where: 'end' }
			});
			expect(r.ok).toBe(true);
			r = await addColumns(ctx('cols'), {
				columns: [def({ name: 'first1' }), def({ name: 'first2' })],
				placement: { where: 'first' }
			});
			expect(r.ok).toBe(true);
			r = await addColumns(ctx('cols'), {
				columns: [def({ name: 'mid', index: 'UNIQUE' })],
				placement: { where: 'after', after: 'a' }
			});
			expect(r.ok).toBe(true);
			expect(await names('cols')).toEqual(['first1', 'first2', 'a', 'mid', 'b', 'z']);
			expect((await loadIndexes(dbi, db, 'cols')).map((i) => [i.kind, i.columns[0].name])).toEqual([
				['UNIQUE', 'mid']
			]);
		});

		it('rejects duplicate columns, unknown anchors and a second primary key', async (c) => {
			if (!conn) return c.skip();
			await q('CREATE TABLE `rej` (`id` INT NOT NULL, PRIMARY KEY (`id`))');
			const dup = await addColumns(ctx('rej'), {
				columns: [def({ name: 'ID' })],
				placement: { where: 'end' }
			});
			expect(dup.ok).toBe(false);
			const anchor = await addColumns(ctx('rej'), {
				columns: [def({ name: 'x' })],
				placement: { where: 'after', after: 'nope' }
			});
			expect(anchor.ok).toBe(false);
			const pk = await addColumns(ctx('rej'), {
				columns: [def({ name: 'x', index: 'PRIMARY' })],
				placement: { where: 'end' }
			});
			expect(pk).toMatchObject({ ok: false, error: expect.stringContaining('primary key') });
		});

		it('adds an auto-increment column with a primary key', async (c) => {
			if (!conn) return c.skip();
			await q('CREATE TABLE `ai` (`a` INT)');
			const r = await addColumns(ctx('ai'), {
				columns: [def({ name: 'id', autoIncrement: true })],
				placement: { where: 'first' }
			});
			expect(r.ok).toBe(true);
			const keys = await loadIndexes(dbi, db, 'ai');
			expect(keys[0]).toMatchObject({ kind: 'PRIMARY' });
		});

		it('changes columns keeping the rest of the definition', async (c) => {
			if (!conn) return c.skip();
			await q(
				"CREATE TABLE `chg` (`id` INT UNSIGNED NOT NULL AUTO_INCREMENT, `s` VARCHAR(20) NOT NULL DEFAULT 'x' COMMENT 'hello', " +
					"`t` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, `e` ENUM('a','b') NOT NULL DEFAULT 'b', PRIMARY KEY (`id`))"
			);
			const caps = await getCaps(dbi);
			const before = await loadColumns(dbi, db, 'chg', caps);
			// round trip: re-applying the reported definitions changes nothing
			const same = await changeColumns(ctx('chg'), {
				changes: before.map((b) => ({ oldName: b.def.name, col: b.def }))
			});
			expect(same.ok).toBe(true);
			const after = await loadColumns(dbi, db, 'chg', caps);
			expect(after.map((a) => buildColumnSpec(a.def, caps))).toEqual(
				before.map((b) => buildColumnSpec(b.def, caps))
			);
			expect(after.map((a) => a.columnType)).toEqual(before.map((b) => b.columnType));
			// rename + retype
			const s = before[1].def;
			const r = await changeColumns(ctx('chg'), {
				changes: [{ oldName: 's', col: { ...s, name: 'title', length: '50' } }]
			});
			expect(r.ok).toBe(true);
			const [, title] = await loadColumns(dbi, db, 'chg', caps);
			expect(title.def).toMatchObject({
				name: 'title',
				length: '50',
				defaultValue: 'x',
				comment: 'hello'
			});
			const bad = await changeColumns(ctx('chg'), {
				changes: [{ oldName: 'title', col: { ...title.def, name: 'id' } }]
			});
			expect(bad.ok).toBe(false);
		});

		it('moves columns', async (c) => {
			if (!conn) return c.skip();
			await q(
				"CREATE TABLE `mv` (`a` INT NOT NULL, `b` VARCHAR(5) NOT NULL DEFAULT 'q', `c` INT NULL, `d` INT NOT NULL)"
			);
			let r = await moveColumns(ctx('mv'), { order: ['d', 'a', 'b', 'c'] });
			expect(r.ok).toBe(true);
			expect(await names('mv')).toEqual(['d', 'a', 'b', 'c']);
			r = await moveColumns(ctx('mv'), { order: ['c', 'b', 'a', 'd'] });
			expect(r.ok).toBe(true);
			expect(await names('mv')).toEqual(['c', 'b', 'a', 'd']);
			const [, b] = await loadColumns(dbi, db, 'mv', await getCaps(dbi));
			expect(b.def).toMatchObject({ defaultValue: 'q', length: '5' });
			expect((await moveColumns(ctx('mv'), { order: ['c', 'b', 'a', 'd'] })).ok).toBe(false);
			expect((await moveColumns(ctx('mv'), { order: ['c', 'b'] })).ok).toBe(false);
		});

		it('drops columns but never all of them', async (c) => {
			if (!conn) return c.skip();
			await q('CREATE TABLE `drp` (`a` INT, `b` INT, `c` INT)');
			expect((await dropColumns(ctx('drp'), { columns: ['a', 'c'] })).ok).toBe(true);
			expect(await names('drp')).toEqual(['b']);
			expect((await dropColumns(ctx('drp'), { columns: ['b'] })).ok).toBe(false);
			expect((await dropColumns(ctx('drp'), { columns: ['zz'] })).ok).toBe(false);
		});

		it('creates, edits, renames and drops indexes', async (c) => {
			if (!conn) return c.skip();
			await q(
				'CREATE TABLE `ix` (`id` INT NOT NULL, `a` VARCHAR(100) NOT NULL, `b` INT NOT NULL, `body` TEXT NOT NULL)'
			);
			// shortcuts
			expect((await addKey(ctx('ix'), { kind: 'PRIMARY', columns: ['id'] })).ok).toBe(true);
			const second = await addKey(ctx('ix'), { kind: 'PRIMARY', columns: ['b'] });
			expect(second.ok).toBe(false);
			expect(
				(await addKey(ctx('ix'), { kind: 'PRIMARY', columns: ['id', 'b'], replacePrimary: true }))
					.ok
			).toBe(true);
			expect((await addKey(ctx('ix'), { kind: 'UNIQUE', columns: ['a', 'b'] })).ok).toBe(true);
			let keys = await loadIndexes(dbi, db, 'ix');
			expect(keys.map((k) => [k.name, k.kind, k.columns.map((x) => x.name)])).toEqual([
				['PRIMARY', 'PRIMARY', ['id', 'b']],
				['a', 'UNIQUE', ['a', 'b']]
			]);

			// composite with sub-part and options
			let r = await saveIndex(ctx('ix'), {
				original: null,
				def: idx({
					name: 'comp',
					columns: [{ name: 'a', size: '10' }, ...cols('b')],
					comment: 'my comment',
					keyBlockSize: '4'
				})
			});
			expect(r).toMatchObject({ ok: true });
			keys = await loadIndexes(dbi, db, 'ix');
			const comp = keys.find((k) => k.name === 'comp')!;
			expect(comp.columns.map((x) => [x.name, x.subPart])).toEqual([
				['a', 10],
				['b', null]
			]);
			expect(comp.indexComment).toBe('my comment');
			// MySQL accepts but does not keep an index-level KEY_BLOCK_SIZE for InnoDB
			expect(comp.keyBlockSize).toBe(port === 33307 ? '4' : '');

			// fulltext
			r = await saveIndex(ctx('ix'), {
				original: null,
				def: idx({ name: 'ft', kind: 'FULLTEXT', columns: cols('body') })
			});
			expect(r.ok).toBe(true);
			expect((await loadIndexes(dbi, db, 'ix')).find((k) => k.name === 'ft')?.kind).toBe(
				'FULLTEXT'
			);

			// edit: change columns and kind (INDEX -> UNIQUE)
			r = await saveIndex(ctx('ix'), {
				original: 'comp',
				def: idx({ name: 'comp', kind: 'UNIQUE', columns: [{ name: 'b', size: '' }, ...cols('a')] })
			});
			expect(r.ok).toBe(true);
			const edited = (await loadIndexes(dbi, db, 'ix')).find((k) => k.name === 'comp')!;
			expect(edited.kind).toBe('UNIQUE');
			expect(edited.columns.map((x) => x.name)).toEqual(['b', 'a']);

			// rename
			expect((await renameIndex(ctx('ix'), { from: 'comp', to: 'renamed' })).ok).toBe(true);
			expect((await renameIndex(ctx('ix'), { from: 'PRIMARY', to: 'x' })).ok).toBe(false);
			expect((await renameIndex(ctx('ix'), { from: 'renamed', to: 'ft' })).ok).toBe(false);
			keys = await loadIndexes(dbi, db, 'ix');
			expect(keys.map((k) => k.name).sort()).toEqual(['PRIMARY', 'a', 'ft', 'renamed']);

			// invisible / ignored
			const caps = await getCaps(dbi);
			r = await saveIndex(ctx('ix'), {
				original: null,
				def: idx({ name: 'hidden', columns: cols('b'), invisible: true })
			});
			expect(r.ok).toBe(true);
			const hidden = (await loadIndexes(dbi, db, 'ix')).find((k) => k.name === 'hidden')!;
			expect(hidden.visible).toBe(caps.serverType === 'MariaDB' && caps.version < 100600);

			// validation: unknown column, duplicate name
			expect(
				(await saveIndex(ctx('ix'), { original: null, def: idx({ columns: cols('zz') }) })).ok
			).toBe(false);
			expect(
				(
					await saveIndex(ctx('ix'), {
						original: null,
						def: idx({ name: 'ft', columns: cols('b') })
					})
				).ok
			).toBe(false);

			// drop
			expect((await dropIndex(ctx('ix'), { name: 'renamed' })).ok).toBe(true);
			expect((await dropIndex(ctx('ix'), { name: 'PRIMARY' })).ok).toBe(true);
			expect((await dropIndex(ctx('ix'), { name: 'nope' })).ok).toBe(false);
		});

		it('adds, edits and drops foreign keys with referential actions', async (c) => {
			if (!conn) return c.skip();
			await q(
				'CREATE TABLE `parent` (`id` INT NOT NULL, `code` VARCHAR(10) NOT NULL, `x` INT, PRIMARY KEY (`id`), UNIQUE KEY `code` (`code`))'
			);
			await q(
				'CREATE TABLE `child` (`id` INT NOT NULL, `pid` INT, `pcode` VARCHAR(10), PRIMARY KEY (`id`))'
			);
			await q('CREATE TABLE `myi` (`id` INT NOT NULL, `pid` INT) ENGINE=MyISAM');

			let r = await saveForeignKey(ctx('child'), {
				original: null,
				def: newFkDef({
					name: 'fk_parent',
					columns: ['pid'],
					refDb: db,
					refTable: 'parent',
					refColumns: ['id'],
					onDelete: 'CASCADE',
					onUpdate: 'RESTRICT'
				})
			});
			expect(r.ok).toBe(true);
			let fks = await loadForeignKeys(dbi, db, 'child');
			expect(fks).toHaveLength(1);
			expect(fks[0]).toMatchObject({
				name: 'fk_parent',
				columns: ['pid'],
				refDb: db,
				refTable: 'parent',
				refColumns: ['id'],
				onDelete: 'CASCADE'
			});

			// ON DELETE CASCADE works
			await q("INSERT INTO `parent` VALUES (1, 'a', 0)");
			await q('INSERT INTO `child` VALUES (1, 1, NULL)');
			await q('DELETE FROM `parent` WHERE id = 1');
			const [cnt] = (await conn.query('SELECT COUNT(*) AS n FROM `child`'))[0] as { n: number }[];
			expect(Number(cnt.n)).toBe(0);

			// referenced column not indexed
			r = await saveForeignKey(ctx('child'), {
				original: null,
				def: newFkDef({ columns: ['pid'], refDb: db, refTable: 'parent', refColumns: ['x'] })
			});
			expect(r).toMatchObject({ ok: false, error: expect.stringContaining('indexed') });

			// engine without FK support
			r = await saveForeignKey(ctx('myi'), {
				original: null,
				def: newFkDef({ columns: ['pid'], refDb: db, refTable: 'parent', refColumns: ['id'] })
			});
			expect(r).toMatchObject({ ok: false, error: expect.stringContaining('InnoDB') });

			// edit (drop + add): point to the unique column, SET NULL
			r = await saveForeignKey(ctx('child'), {
				original: 'fk_parent',
				def: newFkDef({
					name: 'fk_code',
					columns: ['pcode'],
					refDb: db,
					refTable: 'parent',
					refColumns: ['code'],
					onDelete: 'SET NULL',
					onUpdate: 'CASCADE'
				})
			});
			expect(r.ok).toBe(true);
			fks = await loadForeignKeys(dbi, db, 'child');
			expect(fks.map((f) => [f.name, f.onDelete, f.onUpdate])).toEqual([
				['fk_code', 'SET NULL', 'CASCADE']
			]);

			// a failing edit restores the original
			r = await saveForeignKey(ctx('child'), {
				original: 'fk_code',
				def: newFkDef({
					name: 'fk_bad',
					columns: ['pid'],
					refDb: db,
					refTable: 'parent',
					refColumns: ['code']
				})
			});
			expect(r.ok).toBe(false);
			expect((await loadForeignKeys(dbi, db, 'child')).map((f) => f.name)).toEqual(['fk_code']);

			// drop
			expect((await dropForeignKey(ctx('child'), { name: 'fk_code' })).ok).toBe(true);
			expect(await loadForeignKeys(dbi, db, 'child')).toEqual([]);
			expect((await dropForeignKey(ctx('child'), { name: 'fk_code' })).ok).toBe(false);
		});

		it('shows partitions and statistics', async (c) => {
			if (!conn) return c.skip();
			await q('CREATE TABLE `plain` (`id` INT)');
			expect(await loadPartitions(dbi, db, 'plain')).toBeNull();
			await q(
				'CREATE TABLE `part` (`id` INT NOT NULL, `d` INT NOT NULL) PARTITION BY RANGE (`id`) ' +
					'(PARTITION p0 VALUES LESS THAN (10), PARTITION p1 VALUES LESS THAN (20), PARTITION pmax VALUES LESS THAN MAXVALUE)'
			);
			await q('INSERT INTO `part` VALUES (1, 1), (15, 1)');
			const p = await loadPartitions(dbi, db, 'part');
			expect(p).toMatchObject({ method: 'RANGE', expression: '`id`' });
			expect(p!.partitions.map((x) => [x.name, x.description])).toEqual([
				['p0', '10'],
				['p1', '20'],
				['pmax', 'MAXVALUE']
			]);
			const stats = await loadStats(dbi, db, 'part');
			expect(stats?.engine).toBe('InnoDB');
			expect(stats?.createOptions).toMatch(/partitioned/);
			expect(await loadStats(dbi, db, 'nope')).toBeNull();
		});

		it('keeps hostile identifiers safe', async (c) => {
			if (!conn) return c.skip();
			await q('CREATE TABLE `we``ird` (`a` INT, `b``c` INT)');
			expect((await dropColumns(ctx('we`ird'), { columns: ['b`c'] })).ok).toBe(true);
			expect(await names('we`ird')).toEqual(['a']);
		});
	});
}

describe('internal relations (configuration storage)', () => {
	const port = 33306;
	const db = 'tmp_t4b_pma_33306';
	let conn: Connection | undefined;
	let dbi: DatabaseInterface;
	const server: RelationServer = {
		host: '127.0.0.1',
		port,
		socket: '',
		ssl: false,
		ssl_ca: null,
		ssl_cert: null,
		ssl_key: null,
		ssl_ciphers: null,
		ssl_verify: true,
		compress: false,
		controlhost: '',
		controlport: 0,
		controluser: '',
		controlpass: '',
		pmadb: 'phpmyadmin',
		column_info: 'pma__column_info',
		relation: 'pma__relation',
		table_info: 'pma__table_info'
	};
	let storage = false;

	beforeAll(async () => {
		try {
			conn = await createConnection(server, 'root', 'root');
			dbi = new DatabaseInterface(conn, { only_db: '', hide_db: '', host: '127.0.0.1', port });
			await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
			await conn.query(`CREATE DATABASE \`${db}\``);
			await conn.query(
				`CREATE TABLE \`${db}\`.\`a\` (\`id\` INT, \`b_id\` INT, \`label\` VARCHAR(5))`
			);
			await conn.query(`CREATE TABLE \`${db}\`.\`b\` (\`id\` INT)`);
			const f = await detectStorage(dbi, server);
			storage = f.relation && f.tableInfo;
		} catch {
			conn = undefined;
		}
	});
	afterAll(async () => {
		if (conn) {
			if (storage) {
				await conn.query('DELETE FROM `phpmyadmin`.`pma__relation` WHERE master_db = ?', [db]);
				await conn.query('DELETE FROM `phpmyadmin`.`pma__table_info` WHERE db_name = ?', [db]);
			}
			await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
			await conn.end();
		}
	});

	it('feature detection is false without a configured table', async (c) => {
		if (!conn) return c.skip();
		expect(await detectStorage(dbi, { ...server, pmadb: '' })).toEqual({
			relation: false,
			tableInfo: false
		});
		expect(await detectStorage(dbi, { ...server, relation: 'pma__nope' })).toMatchObject({
			relation: false
		});
	});

	it('stores internal relations and the display column', async (c) => {
		if (!conn || !storage) return c.skip();
		const ctx = { dbi, db, table: 'a' };
		const r = await saveInternalRelation(ctx, server, {
			column: 'b_id',
			refDb: db,
			refTable: 'b',
			refColumn: 'id'
		});
		expect(r.ok).toBe(true);
		expect(await loadInternalRelations(dbi, server, db, 'a')).toEqual([
			{ column: 'b_id', refDb: db, refTable: 'b', refColumn: 'id' }
		]);
		// replace, then remove
		await saveInternalRelation(ctx, server, {
			column: 'b_id',
			refDb: db,
			refTable: 'b',
			refColumn: 'id'
		});
		expect(await loadInternalRelations(dbi, server, db, 'a')).toHaveLength(1);
		await saveInternalRelation(ctx, server, {
			column: 'b_id',
			refDb: '',
			refTable: '',
			refColumn: ''
		});
		expect(await loadInternalRelations(dbi, server, db, 'a')).toEqual([]);
		expect(
			(
				await saveInternalRelation(ctx, server, {
					column: 'zz',
					refDb: db,
					refTable: 'b',
					refColumn: 'id'
				})
			).ok
		).toBe(false);

		expect((await saveDisplayField(ctx, server, { column: 'label' })).ok).toBe(true);
		expect(await loadDisplayField(dbi, server, db, 'a')).toBe('label');
		expect((await saveDisplayField(ctx, server, { column: 'zz' })).ok).toBe(false);
		await saveDisplayField(ctx, server, { column: '' });
		expect(await loadDisplayField(dbi, server, db, 'a')).toBe('');
	});
});
