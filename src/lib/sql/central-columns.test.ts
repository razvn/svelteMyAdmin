import { describe, expect, it } from 'vitest';
import {
	decodeExtra,
	extractColumnSpec,
	fromColumnDef,
	fromRow,
	fromShowColumn,
	toColumnDef,
	toRowValues
} from './central-columns.ts';

describe('central columns encoding', () => {
	it('extracts the column spec', () => {
		expect(extractColumnSpec('int(10) unsigned zerofill')).toEqual({
			type: 'int',
			length: '10',
			attribute: 'UNSIGNED ZEROFILL'
		});
		expect(extractColumnSpec("enum('a','b')")).toEqual({
			type: 'enum',
			length: "'a','b'",
			attribute: ''
		});
		expect(extractColumnSpec('decimal(10,2) unsigned').length).toBe('10,2');
		expect(extractColumnSpec('text')).toEqual({ type: 'text', length: '', attribute: '' });
	});

	it('stores col_extra as "extra,attribute"', () => {
		const c = fromShowColumn({
			field: 'id',
			type: 'int(10) unsigned',
			collation: null,
			null: false,
			extra: 'auto_increment',
			default: null
		});
		expect(toRowValues(c)).toEqual(['id', 'int', '10', '', 0, 'auto_increment,UNSIGNED', '']);
		expect(toRowValues({ ...c, extra: '', attribute: '' })[5]).toBe(',');
	});

	it('decodes rows like handleColumnExtra', () => {
		expect(decodeExtra('auto_increment,UNSIGNED')).toEqual({
			extra: 'auto_increment',
			attribute: 'UNSIGNED'
		});
		expect(decodeExtra(',')).toEqual({ extra: '', attribute: '' });
		expect(decodeExtra('DEFAULT_GENERATED,on update CURRENT_TIMESTAMP').attribute).toBe(
			'on update CURRENT_TIMESTAMP'
		);
		const c = fromRow({
			col_name: 'a',
			col_type: 'varchar',
			col_length: '20',
			col_collation: 'utf8mb4_general_ci',
			col_isNull: 1,
			col_extra: ',',
			col_default: null
		});
		expect(c).toMatchObject({ name: 'a', isNull: true, length: '20', default: '' });
	});

	it('maps to and from the column editor', () => {
		const def = toColumnDef({
			name: 'ts',
			type: 'timestamp',
			length: '',
			collation: '',
			isNull: false,
			extra: '',
			attribute: '',
			default: 'CURRENT_TIMESTAMP'
		});
		expect(def).toMatchObject({ type: 'TIMESTAMP', defaultType: 'CURRENT_TIMESTAMP' });
		expect(fromColumnDef(def).default).toBe('CURRENT_TIMESTAMP');
		const ai = toColumnDef({
			name: 'x',
			type: 'int',
			length: '',
			collation: '',
			isNull: false,
			extra: 'auto_increment',
			attribute: '',
			default: '5'
		});
		expect(ai).toMatchObject({
			autoIncrement: true,
			defaultType: 'USER_DEFINED',
			defaultValue: '5'
		});
		expect(fromColumnDef(ai).extra).toBe('auto_increment');
	});
});
