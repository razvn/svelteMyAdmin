import { describe, expect, it } from 'vitest';
import type { ServerCaps } from './column-definition.ts';
import {
	buildAddKey,
	buildDropIndex,
	buildIndexClause,
	buildRenameIndex,
	buildSaveIndex,
	groupIndexes,
	indexToDef,
	newIndexDef,
	parseKeyOptions,
	supportsInvisibleIndex,
	supportsRenameIndex,
	validateIndexDef,
	type IndexRow
} from './index-definition.ts';

const mysql: ServerCaps = { serverType: 'MySQL', version: 80404 };
const maria: ServerCaps = { serverType: 'MariaDB', version: 110406 };
const cols = (...n: string[]) => n.map((name) => ({ name, size: '' }));

describe('buildIndexClause', () => {
	it('plain index without name', () => {
		expect(buildIndexClause(newIndexDef({ columns: cols('a') }), mysql)).toBe('INDEX (`a`)');
	});
	it('composite with sub-part, name and options', () => {
		const def = newIndexDef({
			name: 'ix',
			kind: 'UNIQUE',
			columns: [{ name: 'a', size: '10' }, ...cols('b')],
			keyBlockSize: '4',
			indexType: 'BTREE',
			comment: "it's",
			invisible: true
		});
		expect(buildIndexClause(def, mysql)).toBe(
			"UNIQUE `ix` (`a`(10), `b`) USING BTREE KEY_BLOCK_SIZE = 4 COMMENT 'it\\'s' INVISIBLE"
		);
		expect(buildIndexClause(def, maria)).toMatch(/ IGNORED$/);
	});
	it('invisible ignored on old servers and primary', () => {
		const def = newIndexDef({ columns: cols('a'), invisible: true });
		expect(buildIndexClause(def, { serverType: 'MySQL', version: 50740 })).toBe('INDEX (`a`)');
		expect(
			buildIndexClause(newIndexDef({ kind: 'PRIMARY', name: 'PRIMARY', columns: cols('a') }), mysql)
		).toBe('PRIMARY KEY (`a`)');
	});
	it('fulltext with parser, no type', () => {
		const def = newIndexDef({ kind: 'FULLTEXT', name: 'ft', columns: cols('t'), parser: 'ngram' });
		expect(buildIndexClause(def, mysql)).toBe('FULLTEXT `ft` (`t`) WITH PARSER `ngram`');
	});
	it('feature detection', () => {
		expect(supportsInvisibleIndex(mysql)).toBe(true);
		expect(supportsInvisibleIndex({ serverType: 'MariaDB', version: 100500 })).toBe(false);
		expect(supportsRenameIndex({ serverType: 'MariaDB', version: 100400 })).toBe(false);
		expect(supportsRenameIndex(maria)).toBe(true);
	});
});

describe('statements', () => {
	it('create', () => {
		expect(buildSaveIndex('d', 't', newIndexDef({ columns: cols('a') }), null, mysql)).toBe(
			'ALTER TABLE `d`.`t`\n  ADD INDEX (`a`);'
		);
	});
	it('edit = drop + add atomically', () => {
		expect(
			buildSaveIndex(
				'd',
				't',
				newIndexDef({ name: 'n', kind: 'UNIQUE', columns: cols('a') }),
				{ name: 'old', kind: 'INDEX' },
				mysql
			)
		).toBe('ALTER TABLE `d`.`t`\n  DROP INDEX `old`,\n  ADD UNIQUE `n` (`a`);');
		expect(
			buildSaveIndex(
				'd',
				't',
				newIndexDef({ kind: 'PRIMARY', columns: cols('a', 'b') }),
				{ name: 'PRIMARY', kind: 'PRIMARY' },
				mysql
			)
		).toBe('ALTER TABLE `d`.`t`\n  DROP PRIMARY KEY,\n  ADD PRIMARY KEY (`a`, `b`);');
	});
	it('drop / rename / shortcuts', () => {
		expect(buildDropIndex('d', 't', 'x', 'INDEX')).toBe('ALTER TABLE `d`.`t` DROP INDEX `x`;');
		expect(buildDropIndex('d', 't', 'PRIMARY', 'PRIMARY')).toBe(
			'ALTER TABLE `d`.`t` DROP PRIMARY KEY;'
		);
		expect(buildRenameIndex('d', 't', 'a', 'b')).toBe(
			'ALTER TABLE `d`.`t` RENAME INDEX `a` TO `b`;'
		);
		expect(buildAddKey('d', 't', 'UNIQUE', ['a', 'b'])).toBe(
			'ALTER TABLE `d`.`t` ADD UNIQUE (`a`, `b`);'
		);
		expect(buildAddKey('d', 't', 'PRIMARY', ['a'], { replacePrimary: true })).toBe(
			'ALTER TABLE `d`.`t` DROP PRIMARY KEY, ADD PRIMARY KEY (`a`);'
		);
		expect(buildAddKey('d', 't', 'FULLTEXT', ['a'])).toContain('ADD FULLTEXT (`a`)');
	});
});

describe('validateIndexDef', () => {
	const v = (o: Parameters<typeof newIndexDef>[0]) => validateIndexDef(newIndexDef(o), ['a', 'b']);
	it('accepts valid', () => expect(v({ columns: cols('a') })).toBeNull());
	it('rejects problems', () => {
		expect(v({})).toMatch(/at least one/);
		expect(v({ columns: cols('') })).toMatch(/Choose a column/);
		expect(v({ columns: cols('a', 'a') })).toMatch(/twice/);
		expect(v({ columns: cols('z') })).toMatch(/Unknown/);
		expect(v({ columns: [{ name: 'a', size: 'x' }] })).toMatch(/sub-part/);
		expect(v({ kind: 'FULLTEXT', columns: [{ name: 'a', size: '3' }] })).toMatch(/cannot have/);
		expect(v({ kind: 'PRIMARY', name: 'x', columns: cols('a') })).toMatch(/PRIMARY/);
		expect(v({ parser: 'p', columns: cols('a') })).toMatch(/FULLTEXT/);
		expect(v({ kind: 'PRIMARY', invisible: true, columns: cols('a') })).toMatch(/invisible/);
	});
});

describe('groupIndexes', () => {
	const row = (o: Partial<IndexRow>): IndexRow => ({
		keyName: 'k',
		nonUnique: true,
		seqInIndex: 1,
		columnName: 'a',
		collation: 'A',
		cardinality: 3,
		subPart: null,
		packed: null,
		nullable: false,
		indexType: 'BTREE',
		comment: '',
		indexComment: '',
		expression: null,
		visible: true,
		...o
	});
	it('groups and classifies', () => {
		const idx = groupIndexes(
			[
				row({ keyName: 'PRIMARY', nonUnique: false }),
				row({ keyName: 'u', nonUnique: false, seqInIndex: 2, columnName: 'b' }),
				row({ keyName: 'u', nonUnique: false, seqInIndex: 1, columnName: 'a', subPart: 5 }),
				row({ keyName: 'f', indexType: 'FULLTEXT' }),
				row({ keyName: 's', indexType: 'SPATIAL' }),
				row({ keyName: 'i', visible: false })
			],
			{ f: { parser: 'ngram' }, i: { keyBlockSize: '8' } }
		);
		expect(idx.map((i) => [i.name, i.kind])).toEqual([
			['PRIMARY', 'PRIMARY'],
			['u', 'UNIQUE'],
			['f', 'FULLTEXT'],
			['s', 'SPATIAL'],
			['i', 'INDEX']
		]);
		expect(idx[1].columns.map((c) => c.name)).toEqual(['a', 'b']);
		expect(idx[1].columns[0].subPart).toBe(5);
		const def = indexToDef(idx[4]);
		expect(def.invisible).toBe(true);
		expect(def.keyBlockSize).toBe('8');
		expect(def.indexType).toBe('BTREE');
		expect(indexToDef(idx[2]).parser).toBe('ngram');
	});
	it('functional parts are not editable', () => {
		const [i] = groupIndexes([row({ columnName: null, expression: '(a+1)' })]);
		expect(i.editable).toBe(false);
	});
});

describe('parseKeyOptions', () => {
	it('reads block size and parser', () => {
		const sql = [
			'CREATE TABLE `t` (',
			'  `a` int,',
			'  KEY `x` (`a`) KEY_BLOCK_SIZE=4,',
			'  FULLTEXT KEY `f``q` (`t`) /*!50100 WITH PARSER `ngram` */,',
			'  UNIQUE KEY `u` (`a`)',
			') ENGINE=InnoDB'
		].join('\n');
		expect(parseKeyOptions(sql)).toEqual({
			x: { keyBlockSize: '4' },
			'f`q': { parser: 'ngram' }
		});
	});
});
