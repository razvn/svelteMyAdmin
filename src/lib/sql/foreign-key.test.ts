import { describe, expect, it } from 'vitest';
import {
	buildAddForeignKey,
	buildDropForeignKey,
	columnsAreIndexed,
	groupForeignKeys,
	newFkDef,
	supportsForeignKeys,
	validateFkDef
} from './foreign-key.ts';
import { groupIndexes, type IndexRow } from './index-definition.ts';

describe('foreign key SQL', () => {
	it('add with actions and name', () => {
		const def = newFkDef({
			name: 'fk_a',
			columns: ['a', 'b'],
			refDb: 'o`db',
			refTable: 'r',
			refColumns: ['x', 'y'],
			onDelete: 'CASCADE',
			onUpdate: 'SET NULL'
		});
		expect(buildAddForeignKey('d', 't', def)).toBe(
			'ALTER TABLE `d`.`t`\n  ADD CONSTRAINT `fk_a` FOREIGN KEY (`a`, `b`) REFERENCES `o``db`.`r` (`x`, `y`) ON DELETE CASCADE ON UPDATE SET NULL;'
		);
	});
	it('unnamed without actions', () => {
		const def = newFkDef({ columns: ['a'], refDb: 'd', refTable: 'r', refColumns: ['id'] });
		expect(buildAddForeignKey('d', 't', def)).toBe(
			'ALTER TABLE `d`.`t`\n  ADD FOREIGN KEY (`a`) REFERENCES `d`.`r` (`id`);'
		);
	});
	it('drop', () => {
		expect(buildDropForeignKey('d', 't', 'fk')).toBe('ALTER TABLE `d`.`t` DROP FOREIGN KEY `fk`;');
	});
});

describe('validateFkDef', () => {
	const ok = newFkDef({ columns: ['a'], refDb: 'd', refTable: 'r', refColumns: ['id'] });
	it('accepts', () => expect(validateFkDef(ok)).toBeNull());
	it('rejects', () => {
		expect(validateFkDef({ ...ok, columns: [] })).toMatch(/at least one/);
		expect(validateFkDef({ ...ok, refColumns: ['a', 'b'] })).toMatch(/must match/);
		expect(validateFkDef({ ...ok, columns: [''] })).toMatch(/every pair/);
		expect(validateFkDef({ ...ok, columns: ['a', 'a'], refColumns: ['x', 'y'] })).toMatch(/twice/);
		expect(validateFkDef({ ...ok, refTable: '' })).toMatch(/referenced table/);
	});
});

describe('columnsAreIndexed', () => {
	const row = (keyName: string, seq: number, col: string, o: Partial<IndexRow> = {}): IndexRow => ({
		keyName,
		nonUnique: true,
		seqInIndex: seq,
		columnName: col,
		collation: 'A',
		cardinality: 1,
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
	const idx = groupIndexes([
		row('PRIMARY', 1, 'id', { nonUnique: false }),
		row('ab', 1, 'a'),
		row('ab', 2, 'b'),
		row('ft', 1, 't', { indexType: 'FULLTEXT' })
	]);
	it('matches leading columns in any order', () => {
		expect(columnsAreIndexed(['id'], idx)).toBe(true);
		expect(columnsAreIndexed(['a'], idx)).toBe(true);
		expect(columnsAreIndexed(['b', 'a'], idx)).toBe(true);
	});
	it('rejects non-leading, unknown and fulltext', () => {
		expect(columnsAreIndexed(['b'], idx)).toBe(false);
		expect(columnsAreIndexed(['zz'], idx)).toBe(false);
		expect(columnsAreIndexed(['t'], idx)).toBe(false);
	});
});

describe('groupForeignKeys / engines', () => {
	it('groups composite keys in order', () => {
		const base = {
			constraintName: 'f',
			refDb: 'd',
			refTable: 'r',
			deleteRule: 'CASCADE',
			updateRule: 'NO ACTION'
		};
		const fks = groupForeignKeys([
			{ ...base, columnName: 'b', ordinal: 2, refColumn: 'y' },
			{ ...base, columnName: 'a', ordinal: 1, refColumn: 'x' }
		]);
		expect(fks).toHaveLength(1);
		expect(fks[0].columns).toEqual(['a', 'b']);
		expect(fks[0].refColumns).toEqual(['x', 'y']);
		expect(fks[0].onDelete).toBe('CASCADE');
	});
	it('supportsForeignKeys', () => {
		expect(supportsForeignKeys('InnoDB')).toBe(true);
		expect(supportsForeignKeys('MyISAM')).toBe(false);
		expect(supportsForeignKeys(null)).toBe(false);
	});
});
