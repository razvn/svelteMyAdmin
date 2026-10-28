import { describe, expect, it } from 'vitest';
import {
	applyEdits,
	buildQbeQuery,
	columnRef,
	emptyState,
	fromSearchData,
	orderByClause,
	parseColumnRef,
	schemaFromData,
	selectClause,
	toSearchData,
	whereClause,
	type QbeState
} from './qbe.ts';
import type { QuerySchemaData } from './query-schema.ts';

/** authors <- books ; books <- reviews ; reviews -> readers (chain of 4) ; lonely */
const data: QuerySchemaData = {
	tables: [
		{ name: 'authors', columns: ['id', 'name'], rows: 3 },
		{ name: 'books', columns: ['id', 'author_id', 'title'], rows: 4 },
		{ name: 'reviews', columns: ['id', 'book_id', 'reader_id'], rows: 10 },
		{ name: 'readers', columns: ['id', 'nick'], rows: 2 },
		{ name: 'lonely', columns: ['id'], rows: 1 }
	],
	foreignKeys: [
		{
			constraint: 'fk_b',
			table: 'books',
			column: 'author_id',
			refTable: 'authors',
			refColumn: 'id'
		},
		{
			constraint: 'fk_r1',
			table: 'reviews',
			column: 'book_id',
			refTable: 'books',
			refColumn: 'id'
		},
		{
			constraint: 'fk_r2',
			table: 'reviews',
			column: 'reader_id',
			refTable: 'readers',
			refColumn: 'id'
		}
	],
	internalRelations: [],
	indexes: [
		{ table: 'authors', column: 'id', nonUnique: false },
		{ table: 'books', column: 'author_id', nonUnique: true }
	]
};
const schema = schemaFromData(data);

function grid(
	cols: { c: string; show?: boolean; crit?: string; alias?: string; andOr?: 'and' | 'or' }[]
): QbeState {
	const s = emptyState(cols.length, 1);
	cols.forEach((x, i) => {
		const [t, c] = x.c.split('.');
		s.columns[i] = {
			...s.columns[i],
			column: columnRef(t, c),
			show: x.show ?? true,
			criteria: x.crit ?? '',
			alias: x.alias ?? '',
			andOr: x.andOr ?? 'and'
		};
	});
	return s;
}

describe('column refs', () => {
	it('round-trips, including backticks', () => {
		expect(columnRef('a`b', 'c')).toBe('`a``b`.`c`');
		expect(parseColumnRef('`a``b`.`c`')).toEqual({ table: 'a`b', column: 'c' });
		expect(parseColumnRef('`t`.*')).toEqual({ table: 't', column: '*' });
		expect(parseColumnRef('')).toBeNull();
	});
});

describe('select clause', () => {
	it('lists shown columns with aliases', () => {
		const s = grid([
			{ c: 'authors.name', alias: 'who' },
			{ c: 'books.title', show: false },
			{ c: 'books.id' }
		]);
		expect(selectClause(s)).toBe('SELECT `authors`.`name` AS `who`, `books`.`id`\n');
	});
	it('is empty without shown columns', () => {
		expect(selectClause(grid([{ c: 'authors.name', show: false }]))).toBe('');
		expect(selectClause(emptyState())).toBe('');
	});
});

describe('where clause', () => {
	it('inserts criteria as is and joins columns with the previous column operator', () => {
		const s = grid([
			{ c: 'authors.name', crit: "= 'x'", andOr: 'or' },
			{ c: 'books.title', crit: "LIKE 'S%'" }
		]);
		expect(whereClause(s)).toBe(
			"WHERE ((`authors`.`name` = 'x') OR (`books`.`title` LIKE 'S%'))\n"
		);
	});
	it('single criterion has no outer parentheses', () => {
		expect(whereClause(grid([{ c: 'books.id', crit: '> 3' }]))).toBe('WHERE (`books`.`id` > 3)\n');
	});
	it('skips columns without field or criteria', () => {
		const s = grid([{ c: 'books.id' }, { c: 'books.title', crit: "= 'a'" }]);
		expect(whereClause(s)).toBe("WHERE (`books`.`title` = 'a')\n");
		expect(whereClause(emptyState())).toBe('');
	});
	it('appends extra rows with their AND/OR', () => {
		const s = grid([
			{ c: 'books.id', crit: '= 1' },
			{ c: 'books.title', crit: "= 'a'" }
		]);
		s.rows = [
			{ andOr: 'or', cells: ['= 2', ''] },
			{ andOr: 'and', cells: ['> 0', "<> 'z'"] }
		];
		expect(whereClause(s)).toBe(
			"WHERE ((`books`.`id` = 1) AND (`books`.`title` = 'a'))\n" +
				'OR (`books`.`id` = 2)\n' +
				"AND ((`books`.`id` > 0) AND (`books`.`title` <> 'z'))\n"
		);
	});
	it('drops the operator of a leading extra row when nothing precedes it', () => {
		const s = grid([{ c: 'books.id' }]);
		s.rows = [{ andOr: 'or', cells: ['= 2'] }];
		expect(whereClause(s)).toBe('WHERE (`books`.`id` = 2)\n');
	});
	it('uses OR between columns of an extra row according to the column operator', () => {
		const s = grid([{ c: 'books.id', andOr: 'or' }, { c: 'books.title' }]);
		s.rows = [{ andOr: 'or', cells: ['= 1', "= 'a'"] }];
		expect(whereClause(s)).toBe("WHERE ((`books`.`id` = 1) OR (`books`.`title` = 'a'))\n");
	});
});

describe('order by clause', () => {
	it('uses column order when sort orders are incomplete', () => {
		const s = grid([{ c: 'books.title' }, { c: 'books.id' }]);
		s.columns[0].sort = 'DESC';
		s.columns[1].sort = 'ASC';
		expect(orderByClause(s)).toBe('ORDER BY `books`.`title` DESC, `books`.`id` ASC\n');
	});
	it('orders by the sort order row when every column has one (numeric compare)', () => {
		const s = grid([{ c: 'books.title' }, { c: 'books.id' }, { c: 'books.author_id' }]);
		s.columns[0].sort = 'DESC';
		s.columns[0].sortOrder = '10';
		s.columns[1].sort = 'ASC';
		s.columns[1].sortOrder = '2';
		s.columns[2].sort = 'ASC';
		s.columns[2].sortOrder = '3';
		expect(orderByClause(s)).toBe(
			'ORDER BY `books`.`id` ASC, `books`.`author_id` ASC, `books`.`title` DESC\n'
		);
	});
	it('ignores the * selector and unsorted columns', () => {
		const s = grid([{ c: 'books.*' }, { c: 'books.id' }]);
		s.columns[0].sort = 'ASC';
		expect(orderByClause(s)).toBe('');
	});
});

describe('from clause and joins', () => {
	it('joins two related tables with the referenced one first', () => {
		const s = grid([{ c: 'books.title' }, { c: 'authors.name' }]);
		expect(buildQbeQuery(s, schema)).toBe(
			'SELECT `books`.`title`, `authors`.`name`\n' +
				'FROM `authors`\n    LEFT JOIN `books` ON `books`.`author_id` = `authors`.`id`\n'
		);
	});
	it('a criterion starting with = makes its table the master', () => {
		const s = grid([{ c: 'books.title' }, { c: 'authors.name', crit: "= 'x'" }]);
		expect(buildQbeQuery(s, schema)).toContain(
			'FROM `authors`\n    LEFT JOIN `books` ON `books`.`author_id` = `authors`.`id`\nWHERE'
		);
		const t = grid([{ c: 'books.title', crit: "= 'x'" }, { c: 'authors.name' }]);
		expect(buildQbeQuery(t, schema)).toContain(
			'FROM `books`\n    LEFT JOIN `authors` ON `books`.`author_id` = `authors`.`id`\nWHERE'
		);
	});
	it('discovers joins across 3 tables', () => {
		const s = grid([{ c: 'authors.name' }, { c: 'books.title' }, { c: 'reviews.id' }]);
		const from = buildQbeQuery(s, schema).split('FROM ')[1];
		expect(from).toBe(
			// foreign candidates are authors and books; the larger one (books) becomes the master
			'`books`\n    LEFT JOIN `authors` ON `books`.`author_id` = `authors`.`id`' +
				'\n    LEFT JOIN `reviews` ON `reviews`.`book_id` = `books`.`id`\n'
		);
	});
	it('adds an intermediary table to connect clusters', () => {
		const s = grid([{ c: 'authors.name' }, { c: 'readers.nick' }]);
		const from = buildQbeQuery(s, schema).split('FROM ')[1];
		// authors -> books -> reviews -> readers through two intermediary tables is not reachable with
		// one hop, so readers stays a cartesian product; a single-hop chain does join:
		expect(from).toContain('`authors`');
		expect(from).toContain('`readers`');
		const s2 = grid([{ c: 'books.title' }, { c: 'readers.nick' }]);
		const from2 = buildQbeQuery(s2, schema).split('FROM ')[1];
		expect(from2).toContain('LEFT JOIN `reviews` ON');
		expect(from2).toContain('LEFT JOIN `readers` ON `reviews`.`reader_id` = `readers`.`id`');
	});
	it('falls back to a cartesian product without relations', () => {
		const s = grid([{ c: 'lonely.id' }, { c: 'readers.nick' }]);
		expect(buildQbeQuery(s, schema)).toContain('FROM `lonely`, `readers`\n');
	});
	it('puts unrelated tables before the joined cluster', () => {
		const s = grid([{ c: 'lonely.id' }, { c: 'authors.name' }, { c: 'books.title' }]);
		expect(buildQbeQuery(s, schema)).toContain(
			'FROM `lonely`, `authors`\n    LEFT JOIN `books` ON `books`.`author_id` = `authors`.`id`\n'
		);
	});
	it('single table', () => {
		expect(buildQbeQuery(grid([{ c: 'books.*' }]), schema)).toBe(
			'SELECT `books`.*\nFROM `books`\n'
		);
	});
	it('picks the largest table among equally good candidates', () => {
		const s = grid([{ c: 'lonely.id' }, { c: 'readers.nick' }]);
		// no relations: both candidates; readers has more rows -> master of the (empty) cluster
		expect(buildQbeQuery(s, schema)).toContain('`lonely`');
	});
	it('supports internal relations and composite keys', () => {
		const sch = schemaFromData({
			tables: [
				{ name: 'a', columns: ['x', 'y'], rows: 1 },
				{ name: 'b', columns: ['x', 'y'], rows: 1 },
				{ name: 'c', columns: ['f'], rows: 1 }
			],
			foreignKeys: [
				{ constraint: 'k', table: 'b', column: 'x', refTable: 'a', refColumn: 'x' },
				{ constraint: 'k', table: 'b', column: 'y', refTable: 'a', refColumn: 'y' }
			],
			internalRelations: [{ table: 'c', field: 'f', refTable: 'a', refField: 'x' }],
			indexes: []
		});
		const s = grid([{ c: 'a.x' }, { c: 'b.y' }, { c: 'c.f' }]);
		const q = buildQbeQuery(s, sch);
		expect(q).toContain('LEFT JOIN `b` ON `b`.`x` = `a`.`x` AND `b`.`y` = `a`.`y`');
		expect(q).toContain('LEFT JOIN `c` ON `c`.`f` = `a`.`x`');
	});
	it('uses unique/index columns to choose the master', () => {
		// books has an index on author_id, authors a unique key on id; both selected -> unique wins
		const s = grid([{ c: 'books.author_id' }, { c: 'authors.id' }, { c: 'reviews.id' }]);
		expect(buildQbeQuery(s, schema)).toContain('FROM `authors`');
	});
});

describe('applyEdits', () => {
	it('adds and removes columns', () => {
		let s = emptyState(2, 1);
		s = applyEdits(s, { addColumns: 2 });
		expect(s.columns).toHaveLength(4);
		expect(s.rows[0].cells).toHaveLength(4);
		s = applyEdits(s, { addColumns: -10 });
		expect(s.columns).toHaveLength(0);
	});
	it('inserts and deletes columns keeping the cells aligned', () => {
		const s = grid([{ c: 'books.id' }, { c: 'books.title' }, { c: 'books.author_id' }]);
		s.rows = [{ andOr: 'or', cells: ['a', 'b', 'c'] }];
		const t = applyEdits(s, { insertColumns: [1], deleteColumns: [0] });
		expect(t.columns.map((c) => c.column)).toEqual(['', '`books`.`title`', '`books`.`author_id`']);
		expect(t.rows[0].cells).toEqual(['', 'b', 'c']);
	});
	it('inserts, deletes and adds rows', () => {
		let s = emptyState(1, 2);
		s.rows[0].cells[0] = 'first';
		s = applyEdits(s, { insertRows: [0], deleteRows: [1] });
		expect(s.rows.map((r) => r.cells[0])).toEqual(['', 'first']);
		s = applyEdits(s, { addRows: 2 });
		expect(s.rows).toHaveLength(4);
	});
});

describe('saved search data', () => {
	it('round-trips and uses the phpMyAdmin keys', () => {
		const s = grid([
			{ c: 'books.title', alias: 'T', crit: "= 'a'", andOr: 'or' },
			{ c: 'books.id', show: false }
		]);
		s.columns[0].sort = 'DESC';
		s.columns[0].sortOrder = '1';
		s.rows = [
			{ andOr: 'or', cells: ['', '> 1'] },
			{ andOr: 'and', cells: ["= 'b'", ''] }
		];
		const data = toSearchData(s, ['books']);
		expect(data.criteriaColumnCount).toBe(2);
		expect(data.criteriaShow).toEqual({ '0': 'on' });
		expect(data.rows).toBe(1);
		expect(data.Or1).toEqual(["= 'b'", '']);
		const back = fromSearchData(JSON.parse(JSON.stringify(data)));
		expect(back.state).toEqual(s);
		expect(back.tableList).toEqual(['books']);
	});
	it('reads phpMyAdmin payloads (no alias, sparse show object)', () => {
		const { state } = fromSearchData({
			criteriaColumnCount: 2,
			criteriaColumn: ['`a`.`x`', ''],
			criteriaSort: ['ASC', ''],
			criteriaShow: { '0': 'on' },
			criteria: ['= 1', ''],
			criteriaAndOrRow: ['or'],
			criteriaAndOrColumn: ['and', 'or'],
			rows: 0,
			TableList: ['a'],
			Or0: ['', '']
		});
		expect(state.columns[0]).toMatchObject({ column: '`a`.`x`', show: true, sort: 'ASC' });
		expect(state.rows).toHaveLength(1);
	});
});
