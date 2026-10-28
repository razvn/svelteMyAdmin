import { describe, expect, it } from 'vitest';
import {
	buildMultiTableQuery,
	conditionOf,
	emptyMtqColumn,
	foreignKeysFromSchema,
	type MtqColumn,
	type MtqForeignKey
} from './multi-table-query.ts';

const fks: MtqForeignKey[] = [
	{ constraint: 'a', table: 'books', column: 'author_id', refTable: 'authors', refColumn: 'id' },
	{ constraint: 'b', table: 'reviews', column: 'book_id', refTable: 'books', refColumn: 'id' }
];

const col = (o: Partial<MtqColumn>): MtqColumn => ({ ...emptyMtqColumn(), ...o });
const sql = (cols: MtqColumn[], keys = fks) => {
	const r = buildMultiTableQuery(cols, keys);
	if (!r.ok) throw new Error(r.error);
	return r.sql;
};

describe('buildMultiTableQuery', () => {
	it('reports an empty selection', () => {
		expect(buildMultiTableQuery([col({})], fks)).toEqual({ ok: false, error: 'Nothing selected' });
		expect(buildMultiTableQuery([col({ table: 't', column: 'c', show: false })], fks).ok).toBe(
			false
		);
	});
	it('single table with * and alias', () => {
		expect(
			sql([
				col({ table: 'books', column: '*' }),
				col({ table: 'books', column: 'title', columnAlias: 'T' })
			])
		).toBe('SELECT `books`.*, `books`.`title` AS `T`\nFROM `books`;');
	});
	it('joins two tables by foreign key', () => {
		expect(
			sql([col({ table: 'authors', column: 'name' }), col({ table: 'books', column: 'title' })])
		).toBe(
			'SELECT `authors`.`name`, `books`.`title`\nFROM `authors` \n\tLEFT JOIN `books` ON `books`.`author_id` = `authors`.`id`;'
		);
	});
	it('joins 3 tables regardless of selection order', () => {
		const q = sql([
			col({ table: 'reviews', column: 'id' }),
			col({ table: 'authors', column: 'name' }),
			col({ table: 'books', column: 'title' })
		]);
		// the bridging table (books) is joined before authors although it was selected last
		expect(q).toContain(
			'FROM `reviews` \n\tLEFT JOIN `books` ON `reviews`.`book_id` = `books`.`id`'
		);
		expect(q).toContain('LEFT JOIN `authors` ON `books`.`author_id` = `authors`.`id`');
		expect(q).not.toContain('\n\t, ');
	});
	it('chains authors, books, reviews', () => {
		const q = sql([
			col({ table: 'authors', column: 'name' }),
			col({ table: 'books', column: 'title' }),
			col({ table: 'reviews', column: 'id' })
		]);
		expect(q).toContain('LEFT JOIN `books` ON `books`.`author_id` = `authors`.`id`');
		expect(q).toContain('LEFT JOIN `reviews` ON `reviews`.`book_id` = `books`.`id`');
	});
	it('uses table aliases everywhere', () => {
		const q = sql([
			col({ table: 'authors', column: 'name', tableAlias: 'a' }),
			col({
				table: 'books',
				column: 'title',
				tableAlias: 'b',
				useCriteria: true,
				criteriaColumn: 'title',
				op: 'LIKE',
				rhsText: 'S%'
			})
		]);
		expect(q).toBe(
			"SELECT `a`.`name`, `b`.`title`\nFROM `authors` AS `a` \n\tLEFT JOIN `books` AS `b` ON `b`.`author_id` = `a`.`id`\nWHERE `b`.`title` LIKE 'S%';"
		);
	});
	it('combines criteria with AND/OR, in card order', () => {
		const q = sql([
			col({
				table: 'books',
				column: 'id',
				useCriteria: true,
				criteriaColumn: 'id',
				op: '>',
				rhsText: '1'
			}),
			col({
				table: 'books',
				column: 'title',
				useCriteria: true,
				logicalOp: 'OR',
				criteriaColumn: 'title',
				op: 'IS NULL'
			}),
			col({
				table: 'books',
				column: 'price',
				useCriteria: true,
				logicalOp: 'AND',
				criteriaColumn: 'price',
				op: 'IN (...)',
				rhsText: '1, 2'
			})
		]);
		expect(q).toContain(
			"WHERE `books`.`id` > '1' OR `books`.`title` IS NULL AND `books`.`price` IN (1, 2);"
		);
	});
	it('ignores the logical operator of the first criterion', () => {
		const q = sql([
			col({
				table: 'books',
				column: 'id',
				useCriteria: true,
				logicalOp: 'OR',
				criteriaColumn: 'id',
				op: '=',
				rhsText: '1'
			})
		]);
		expect(q).toContain("WHERE `books`.`id` = '1'");
	});
	it('orders by sorted columns', () => {
		const q = sql([
			col({ table: 'books', column: 'title', sort: 'DESC' }),
			col({ table: 'books', column: 'id', sort: 'ASC' })
		]);
		expect(q).toContain('ORDER BY `books`.`title` DESC, `books`.`id` ASC;');
	});
});

describe('conditionOf', () => {
	const base = col({ table: 'books', criteriaColumn: 'title', useCriteria: true });
	it('escapes quotes and backslashes', () => {
		expect(conditionOf({ ...base, op: '=', rhsText: "O'B\\" })).toBe(
			"`books`.`title` = 'O\\'B\\\\'"
		);
	});
	it('formats wildcard operators', () => {
		expect(conditionOf({ ...base, op: 'LIKE %...%', rhsText: 'x' })).toBe(
			"`books`.`title` LIKE '%x%'"
		);
		expect(conditionOf({ ...base, op: 'NOT LIKE %...%', rhsText: 'x' })).toBe(
			"`books`.`title` NOT LIKE '%x%'"
		);
		expect(conditionOf({ ...base, op: 'REGEXP ^...$', rhsText: 'x' })).toBe(
			"`books`.`title` REGEXP '^x$'"
		);
	});
	it('BETWEEN with a and b', () => {
		expect(conditionOf({ ...base, op: 'BETWEEN', rhsText: '1 AND 5' })).toBe(
			"`books`.`title` BETWEEN '1' AND '5'"
		);
	});
	it('another column', () => {
		expect(
			conditionOf({
				...base,
				op: '=',
				rhs: 'anotherColumn',
				rhsTable: 'authors',
				rhsColumn: 'name'
			})
		).toBe('`books`.`title` = `authors`.`name`');
		expect(conditionOf({ ...base, op: '=', rhs: 'anotherColumn' })).toBeNull();
	});
	it('needs a criteria column', () => {
		expect(conditionOf({ ...base, criteriaColumn: '' })).toBeNull();
	});
});

describe('foreignKeysFromSchema', () => {
	it('merges real and internal relations', () => {
		const out = foreignKeysFromSchema({
			tables: [],
			foreignKeys: [{ constraint: 'c', table: 'a', column: 'x', refTable: 'b', refColumn: 'y' }],
			internalRelations: [{ table: 'c', field: 'f', refTable: 'a', refField: 'x' }],
			indexes: []
		});
		expect(out).toHaveLength(2);
		expect(out[1]).toMatchObject({ table: 'c', column: 'f', refTable: 'a', refColumn: 'x' });
	});
});
