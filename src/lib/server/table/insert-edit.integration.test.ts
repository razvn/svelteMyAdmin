import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createConnection, type Connection } from '../db/connection';
import type { ServerConfig } from '../config/schema';
import {
	blankRow,
	buildFormColumns,
	buildStatements,
	executeStatements,
	loadColumns,
	loadRowsByClauses,
	nextRowClause,
	parseSubmission,
	uniqueCondition,
	type FormRow
} from './insert-edit';
import { signClause, verifyClause } from './signed-clause';
import type { FormColumn } from '#lib/sql/insert-edit.ts';
import { InsertEditError } from '#lib/sql/insert-edit.ts';

const servers = [
	{ name: 'mysql 8.4', port: 33306 },
	{ name: 'mariadb 11.4', port: 33307 }
];

const SECRET = 'test-secret';
const settings = {
	ProtectBinary: 'blob' as const,
	DefaultFunctions: { FUNC_SPATIAL: 'GeomFromText', first_timestamp: 'NOW', FUNC_UUID: 'UUID' },
	ForeignKeyMaxLimit: 100,
	ForeignKeyDropdownOrder: ['content-id', 'id-content']
};

for (const { name, port } of servers) {
	describe(`insert / edit against ${name}`, () => {
		let conn: Connection | undefined;
		const db = `tmp_t4c_int_${port}`;
		let cols: FormColumn[] = [];
		const verify = (clause: string, sig: string | null) =>
			verifyClause(SECRET, db, 'zoo', clause, sig);

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
				await conn.query(`DROP DATABASE IF EXISTS \`${db}\``);
				await conn.query(`CREATE DATABASE \`${db}\``);
				await conn.query(`CREATE TABLE \`${db}\`.\`zoo\` LIKE sma_test.type_zoo`);
				await conn.query(`INSERT INTO \`${db}\`.\`zoo\` (id) VALUES (1), (2)`);
				await conn.query(
					`CREATE TABLE \`${db}\`.\`parent\` (id INT PRIMARY KEY, label VARCHAR(20)) ENGINE=InnoDB`
				);
				await conn.query(`INSERT INTO \`${db}\`.\`parent\` VALUES (1,'one'),(2,'two')`);
				await conn.query(
					`CREATE TABLE \`${db}\`.\`child\` (id INT PRIMARY KEY AUTO_INCREMENT, p INT, ` +
						`FOREIGN KEY (p) REFERENCES parent(id)) ENGINE=InnoDB`
				);
				cols = await buildFormColumns(
					conn,
					{ controluser: '', pmadb: '' } as ServerConfig,
					db,
					'zoo',
					await loadColumns(conn, db, 'zoo'),
					settings,
					true
				);
			} catch {
				conn = undefined;
				console.warn(`[integration] ${name} unreachable on 127.0.0.1:${port}, skipping`);
			}
		});
		afterAll(async () => {
			await conn?.query(`DROP DATABASE IF EXISTS \`${db}\``);
			await conn?.end();
		});

		/** The form the browser would post for `rows` (disabled inputs are not sent). */
		function formFor(
			rows: FormRow[],
			submit: string,
			overrides: Record<string, string | string[] | null>[] = []
		): FormData {
			const f = new FormData();
			f.set('rows', String(rows.length));
			f.set('submit_type', submit);
			rows.forEach((row, r) => {
				if (row.where) {
					f.set(`where_${r}`, row.where);
					f.set(`sig_${r}`, row.sig!);
				}
				cols.forEach((col, c) => {
					const cell = { ...row.cells[c] };
					const o = overrides[r]?.[col.name];
					if (o === null) cell.isNull = true;
					else if (Array.isArray(o)) {
						cell.setValues = o;
						cell.isNull = false;
					} else if (typeof o === 'string') {
						cell.value = o;
						cell.isNull = false;
					}
					if (cell.func) f.set(`f_${r}_${c}`, cell.func);
					if (cell.isNull) f.set(`n_${r}_${c}`, '1');
					else if (col.kind === 'set') cell.setValues.forEach((v) => f.append(`v_${r}_${c}`, v));
					else if (!col.protected) f.set(`v_${r}_${c}`, cell.value);
					if (cell.prev !== undefined) f.set(`p_${r}_${c}`, cell.prev);
					if (cell.prevNull) f.set(`pn_${r}_${c}`, '1');
				});
			});
			return f;
		}

		async function run(form: FormData, preview = false) {
			const sub = await parseSubmission(form, cols);
			const built = await buildStatements(conn!, db, 'zoo', cols, sub, verify);
			return executeStatements(conn!, built.statements, preview);
		}

		const signed = async (id: number) => {
			const where = `\`id\` = ${id}`;
			return { where, sig: signClause(SECRET, db, 'zoo', where) };
		};

		it('loads blank rows with defaults', async () => {
			if (!conn) return;
			const row = blankRow(cols);
			const byName = (n: string) => row.cells[cols.findIndex((c) => c.name === n)];
			expect(byName('c_enum').value).toBe('medium');
			expect(byName('c_smallint').isNull).toBe(true);
			expect(byName('c_tinyint').value).toBe('0');
			expect(byName('c_geometry').func).toBe('ST_GeomFromText');
			expect(cols.find((c) => c.name === 'c_blob')?.protected).toBe(true);
			expect(cols.find((c) => c.name === 'c_binary')?.protected).toBe(false);
		});

		it('inserts a value of every type and updates one row by signed clause', async () => {
			if (!conn) return;
			const values = {
				id: '',
				c_tinyint: '7',
				c_smallint: '-5',
				c_mediumint: '123',
				c_int: '2000000000',
				c_bigint: '9223372036854775807',
				c_bigint_u: '18446744073709551615',
				c_bool: '1',
				c_decimal: '12.345678',
				c_float: '1.5',
				c_double: '2.25',
				c_char: 'ab',
				c_varchar: "it's \\ ok",
				c_tinytext: 't',
				c_text: 'line1\nline2',
				c_mediumtext: 'm',
				c_longtext: 'l',
				c_binary: '0x0102030405060708',
				c_varbinary: '0xDEADBEEF',
				c_date: '2024-03-01',
				c_time: '-12:34:56',
				c_datetime: '2024-03-01 10:20:30.123',
				c_timestamp: '2024-03-01 10:20:30',
				c_year: '2024',
				c_enum: 'large',
				c_bit: '10101010',
				c_json: '{"k": [1, 2]}',
				c_geometry: 'POINT(1 2)',
				c_point: 'POINT(3 4)'
			};
			const row = blankRow(cols);
			const form = formFor([row], 'save', [
				{ ...values, c_set: ['a', 'c'], c_blob: null, c_longblob: null }
			]);
			const blobCol = cols.findIndex((c) => c.name === 'c_blob');
			form.set(`u_0_${blobCol}`, new File([Buffer.from([0, 255, 16])], 'x.bin'));
			const res = await run(form);
			expect(res.executed).toBe(true);
			expect(res.affectedRows).toBe(1);
			expect(res.insertId).toBeGreaterThan(2);

			const [[got]] = (await conn.query(
				`SELECT *, HEX(c_binary) AS hb, HEX(c_varbinary) AS hv, HEX(c_blob) AS hblob, c_bit+0 AS bit,
				  ST_AsText(c_geometry) AS g, ST_AsText(c_point) AS p, c_set+0 AS setn
				 FROM \`${db}\`.zoo WHERE id = ?`,
				[res.insertId]
			)) as unknown as [Record<string, unknown>[]];
			expect(got.c_tinyint).toBe(7);
			expect(got.c_bigint).toBe('9223372036854775807');
			expect(got.c_bigint_u).toBe('18446744073709551615');
			expect(got.c_decimal).toBe('12.345678');
			expect(got.c_varchar).toBe("it's \\ ok");
			expect(got.c_text).toBe('line1\nline2');
			expect(got.hb).toBe('0102030405060708');
			expect(got.hv).toBe('DEADBEEF');
			expect(got.hblob).toBe('00FF10');
			expect(got.c_date).toBe('2024-03-01');
			expect(got.c_time).toBe('-12:34:56');
			expect(got.c_datetime).toBe('2024-03-01 10:20:30.123');
			expect(got.c_year).toBe(2024);
			expect(got.c_enum).toBe('large');
			expect(got.c_set).toBe('a,c');
			expect(Number(got.bit)).toBe(170);
			expect(JSON.parse(got.c_json as string)).toEqual({ k: [1, 2] });
			expect(got.g).toBe('POINT(1 2)');
			expect(got.p).toBe('POINT(3 4)');

			// edit it: only the changed column (plus spatial columns, which carry a default function)
			const id = Number(res.insertId);
			const loaded = await loadRowsByClauses(conn, db, 'zoo', cols, [await signed(id)], {
				copy: false,
				defaultFunctions: settings.DefaultFunctions
			});
			expect(loaded.rows).toHaveLength(1);
			const edited = loaded.rows[0];
			const cell = (n: string) => edited.cells[cols.findIndex((c) => c.name === n)];
			expect(cell('c_binary').value).toBe('0x0102030405060708');
			expect(cell('c_bit').value).toBe('10101010');
			expect(cell('c_set').setValues).toEqual(['a', 'c']);
			expect(cell('c_geometry').value).toBe('POINT(1 2)');

			const upd = await run(formFor([edited], 'save', [{ c_varchar: 'changed' }]));
			expect(upd.statements).toHaveLength(1);
			expect(upd.statements[0]).toMatch(/^UPDATE `[^`]+`\.`zoo` SET `c_varchar` = 'changed'/);
			expect(upd.statements[0]).toContain('LIMIT 1');
			expect(upd.statements[0]).not.toContain('c_text');
			expect(upd.affectedRows).toBe(1);
			const [[after]] = (await conn.query(
				`SELECT c_varchar, c_text, ST_AsText(c_geometry) AS g FROM \`${db}\`.zoo WHERE id = ?`,
				[id]
			)) as unknown as [Record<string, unknown>[]];
			expect(after).toEqual({ c_varchar: 'changed', c_text: 'line1\nline2', g: 'POINT(1 2)' });

			// null transitions
			const toNull = await run(formFor([edited], 'save', [{ c_text: null }]));
			expect(toNull.statements[0]).toContain('`c_text` = NULL');
			const [[n1]] = (await conn.query(`SELECT c_text FROM \`${db}\`.zoo WHERE id = ?`, [
				id
			])) as unknown as [Record<string, unknown>[]];
			expect(n1.c_text).toBeNull();

			// insert as new row: copies the protected blob content of the source row
			const asNew = await run(formFor([edited], 'insert', [{ id: '', c_varchar: 'copy' }]));
			expect(asNew.statements[0]).toMatch(/^INSERT INTO/);
			const copyId = Number(asNew.insertId);
			expect(copyId).toBeGreaterThan(id);
			const [[copy]] = (await conn.query(
				`SELECT c_varchar, HEX(c_blob) AS hb, ST_AsText(c_point) AS p FROM \`${db}\`.zoo WHERE id = ?`,
				[copyId]
			)) as unknown as [Record<string, unknown>[]];
			expect(copy).toEqual({ c_varchar: 'copy', hb: '00FF10', p: 'POINT(3 4)' });

			// copy mode loads values, blanks the auto_increment key
			const cp = await loadRowsByClauses(conn, db, 'zoo', cols, [await signed(id)], {
				copy: true,
				defaultFunctions: settings.DefaultFunctions
			});
			expect(cp.rows[0].cells[cols.findIndex((c) => c.name === 'id')].value).toBe('');
			expect(cp.rows[0].cells[cols.findIndex((c) => c.name === 'c_varchar')].value).toBe('changed');
			expect(cp.rows[0].where).toBeUndefined();
		});

		it('previews without executing and rejects forged clauses', async () => {
			if (!conn) return;
			const [[{ n: before }]] = (await conn.query(
				`SELECT COUNT(*) AS n FROM \`${db}\`.zoo`
			)) as unknown as [{ n: number }[]];
			const prev = await run(formFor([blankRow(cols)], 'showinsert', [{ c_varchar: 'x' }]), true);
			expect(prev.executed).toBe(false);
			expect(prev.statements[0]).toMatch(/^INSERT INTO/);
			const [[{ n: after }]] = (await conn.query(
				`SELECT COUNT(*) AS n FROM \`${db}\`.zoo`
			)) as unknown as [{ n: number }[]];
			expect(after).toBe(before);

			const forged = { ...(await signed(1)), sig: 'AAAA' };
			const row: FormRow = { ...blankRow(cols), ...forged };
			await expect(run(formFor([row], 'save', [{ c_varchar: 'h' }]))).rejects.toBeInstanceOf(
				InsertEditError
			);
		});

		it('INSERT IGNORE swallows a duplicate key, plain INSERT fails', async () => {
			if (!conn) return;
			const dup = [{ id: '1', c_varchar: 'dup' }];
			await expect(run(formFor([blankRow(cols)], 'save', dup))).rejects.toMatchObject({
				code: 'ER_DUP_ENTRY'
			});
			const res = await run(formFor([blankRow(cols)], 'insertignore', dup));
			expect(res.affectedRows).toBe(0);
			expect(res.warnings.join(' ')).toMatch(/Duplicate/i);
		});

		it('multi-row insert skips ignored rows', async () => {
			if (!conn) return;
			const rows = [blankRow(cols), blankRow(cols), blankRow(cols)];
			const form = formFor(rows, 'save', [
				{ c_varchar: 'm1' },
				{ c_varchar: 'm2' },
				{ c_varchar: 'm3' }
			]);
			form.set('ignore_2', '1');
			const res = await run(form);
			expect(res.affectedRows).toBe(2);
			expect(res.statements[0]).toContain("'m1'");
			expect(res.statements[0]).not.toContain("'m3'");
		});

		it('foreign key columns list referenced values; next row follows the primary key', async () => {
			if (!conn) return;
			const childCols = await buildFormColumns(
				conn,
				{ controluser: '', pmadb: '' } as ServerConfig,
				db,
				'child',
				await loadColumns(conn, db, 'child'),
				settings,
				true
			);
			const p = childCols.find((c) => c.name === 'p')!;
			expect(p.foreign?.options).toEqual([
				{ value: '1', label: 'one - 1' },
				{ value: '2', label: 'two - 2' }
			]);
			const small = await buildFormColumns(
				conn,
				{ controluser: '', pmadb: '' } as ServerConfig,
				db,
				'child',
				await loadColumns(conn, db, 'child'),
				{ ...settings, ForeignKeyMaxLimit: 1 },
				true
			);
			expect(small.find((c) => c.name === 'p')?.foreign?.options).toBeNull();

			const raw = await loadColumns(conn, db, 'parent');
			const next = await nextRowClause(conn, db, 'parent', raw, '`id` = 1');
			expect(next).toBe('`id` = 2');
			expect(await nextRowClause(conn, db, 'parent', raw, '`id` = 2')).toBeNull();
			expect(uniqueCondition(raw, { id: 5, label: 'x' })).toBe('`id` = 5');
		});
	});
}
