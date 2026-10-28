import { describe, expect, it } from 'vitest';
import codegen, { cgMakeIdentifier, TableProperty } from './codegen.ts';
import { createTestContext, fakeConnection, makeExportData, FIXTURE_FIELDS } from './testing.ts';

const COLUMNS = [
	{ Field: 'id', Type: 'int(11)', Null: 'NO', Key: 'PRI', Default: null, Extra: 'auto_increment' },
	{ Field: 'title', Type: 'varchar(50)', Null: 'NO', Key: 'UNI', Default: null, Extra: '' },
	{ Field: 'price', Type: 'decimal(8,2)', Null: 'YES', Key: '', Default: '0.00', Extra: '' }
];

const conn = fakeConnection([['SHOW FULL COLUMNS', COLUMNS]]);

async function generate(format: string) {
	const t = createTestContext({ format }, { conn });
	await codegen.data?.(
		t.ctx,
		makeExportData({ db: 'sma_test', table: 'books', fields: FIXTURE_FIELDS, rows: [] })
	);
	return t.text();
}

describe('codegen plugin', () => {
	it('has the phpMyAdmin identity and only exports data', () => {
		expect(codegen.id).toBe('codegen');
		expect(codegen.extension).toBe('cs');
		expect(codegen.mimeType).toBe('text/cs');
		expect(codegen.supports).toEqual({ structure: false, data: true });
	});

	it('writes the NHibernate C# domain object (format 0)', async () => {
		expect(await generate('0')).toBe(
			[
				'using System;',
				'using System.Collections;',
				'using System.Collections.Generic;',
				'using System.Text;',
				'namespace Sma_test',
				'{',
				'    #region Books',
				'    public class Books',
				'    {',
				'        #region Member Variables',
				'        protected int _id;',
				'        protected string _title;',
				'        protected unknown _price;',
				'        #endregion',
				'        #region Constructors',
				'        public Books() { }',
				'        public Books(string title, unknown price)',
				'        {',
				'            this._title=title;',
				'            this._price=price;',
				'        }',
				'        #endregion',
				'        #region Public Properties',
				'        public virtual int Id',
				'        {',
				'            get {return _id;}',
				'            set {_id=value;}',
				'        }',
				'        public virtual string Title',
				'        {',
				'            get {return _title;}',
				'            set {_title=value;}',
				'        }',
				'        public virtual unknown Price',
				'        {',
				'            get {return _price;}',
				'            set {_price=value;}',
				'        }',
				'        #endregion',
				'    }',
				'    #endregion',
				'}'
			].join('\n')
		);
	});

	it('writes the NHibernate XML mapping (format 1)', async () => {
		expect(await generate('1')).toBe(
			[
				'<?xml version="1.0" encoding="utf-8" ?>',
				'<hibernate-mapping xmlns="urn:nhibernate-mapping-2.2" namespace="Sma_test" assembly="Sma_test">',
				'    <class name="Books" table="Books">',
				'        <id name="Id" type="Int32" unsaved-value="0">',
				'            <column name="id" sql-type="int" not-null="true" unique="true" index="PRIMARY"/>',
				'            <generator class="native" />',
				'        </id>',
				'        <property name="Title" type="String">',
				'            <column name="title" sql-type="varchar" not-null="true" index="title"/>',
				'        </property>',
				'        <property name="Price" type="Unknown">',
				'            <column name="price" sql-type="decimal" not-null="false" />',
				'        </property>',
				'    </class>',
				'</hibernate-mapping>'
			].join('\n')
		);
	});

	it('reports unsupported formats like phpMyAdmin', async () => {
		expect(await generate('7')).toBe('7 is not supported.');
	});

	it('cgMakeIdentifier keeps letters, numbers and underscores and prefixes non-letters', () => {
		expect(cgMakeIdentifier('my-table name')).toBe('Mytablename');
		expect(cgMakeIdentifier('1abc')).toBe('Abc');
		expect(cgMakeIdentifier('9')).toBe('_');
		expect(cgMakeIdentifier('abc', false)).toBe('abc');
		// PHP's ucfirst() is ASCII-only, so a non-ASCII first letter is left as it is.
		expect(cgMakeIdentifier('élan')).toBe('élan');
	});

	it('maps SQL types to .NET types like TableProperty', () => {
		const prop = new TableProperty({
			field: 'flag',
			type: 'tinyint(1)',
			null: 'NO',
			key: 'MUL',
			default: null,
			extra: '',
			comment: ''
		});
		expect(prop.dotNetPrimitiveType()).toBe('bool');
		expect(prop.dotNetObjectType()).toBe('Boolean');
		expect(prop.pureType()).toBe('tinyint');
		expect(prop.isUnique()).toBe('false');
		expect(prop.indexName()).toBe('index="flag"');
	});
});
