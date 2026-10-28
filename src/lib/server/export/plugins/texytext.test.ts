import { describe, expect, it } from 'vitest';
import texytext, { texyColumnLine } from './texytext.ts';
import {
	booksConnection,
	createTestContext,
	fakeConnection,
	fixtureData,
	makeExportData,
	FIXTURE_FIELDS
} from './testing.ts';

describe('texytext plugin', () => {
	it('has the phpMyAdmin identity', () => {
		expect(texytext.id).toBe('texytext');
		expect(texytext.extension).toBe('txt');
		expect(texytext.supports).toEqual({ structure: true, data: true });
	});

	it('writes the database heading', async () => {
		const t = createTestContext({});
		await texytext.dbHeader?.(t.ctx, 'sma_test', '');
		expect(t.text()).toBe('===Database sma_test\n\n');
	});

	it('writes the structure table with unique and primary markers', async () => {
		const t = createTestContext({}, { conn: booksConnection() });
		await texytext.structure?.(t.ctx, fixtureData().ref, 'structure');
		expect(t.text()).toBe(
			[
				'== Table structure for table books',
				'',
				'|------',
				'|Column|Type|Null|Default',
				'|------',
				'|//**id**//|int|No|',
				'|author_id|int|No|',
				'|**title**|varchar(200)|No|',
				'|price|decimal(8,2)|No|0.00',
				'|published_at|datetime|Yes|NULL',
				'|status|enum(&#039;draft&#039;, &#039;published&#039;, &#039;archived&#039;)|No|draft',
				''
			].join('\n')
		);
	});

	it('writes the data table with NULL text, empty cells as a space and escaped pipes', async () => {
		const t = createTestContext({});
		await texytext.data?.(t.ctx, fixtureData());
		expect(t.text()).toBe(
			[
				'== Dumping data for table books',
				'',
				'|1|Plain|simple|9.99|bin',
				'|2|Quote &quot;x&quot;, semi;colon|line one',
				'line two\r',
				'line three|NULL|NULL',
				'|3|Ünïcode ✓ 日本|tab\there\\back|0|q&quot;',
				'z',
				'|4|Apos &#039; &amp; &lt;tag&gt;| |-12.50| ',
				''
			].join('\n')
		);
	});

	it('writes the column header row and the query heading for raw results', async () => {
		const t = createTestContext({ columns: true, null: '-' });
		await texytext.data?.(
			t.ctx,
			makeExportData({ table: '', fields: FIXTURE_FIELDS.slice(0, 2), rows: [['a|b', null]] })
		);
		expect(t.text()).toBe(
			[
				'==Dumping data for query result',
				'',
				'|------',
				'|id|name',
				'|------',
				'|a&#124;b|-',
				''
			].join('\n')
		);
	});

	it('renders one column line from column info', () => {
		expect(
			texyColumnLine(
				{
					field: 'id',
					type: 'int(10) unsigned',
					null: 'NO',
					key: 'PRI',
					default: null,
					extra: '',
					comment: ''
				},
				['id']
			)
		).toBe('|//**id**//|int(10)|No|');
		expect(
			texyColumnLine(
				{ field: 'bio', type: 'text', null: 'YES', key: '', default: null, extra: '', comment: '' },
				[]
			)
		).toBe('|bio|text|Yes|NULL');
	});

	it('writes the trigger table when the table has triggers', async () => {
		const conn = fakeConnection([
			[
				'SHOW FULL COLUMNS',
				[{ Field: 'id', Type: 'int', Null: 'NO', Key: '', Default: null, Extra: '' }]
			],
			['SHOW INDEX', []],
			[
				'information_schema.TRIGGERS',
				[
					{
						name: 'trg',
						timing: 'BEFORE',
						event: 'INSERT',
						tableName: 'books',
						statement: 'SET NEW.a = 1 || 2'
					}
				]
			]
		]);
		const t = createTestContext({}, { conn });
		await texytext.structure?.(t.ctx, fixtureData().ref, 'structure');
		expect(t.text()).toContain(
			'== Triggers books\n\n|------\n|Name|Time|Event|Definition\n|------\n|trg|BEFORE|INSERT|SET NEW.a = 1 &#124;&#124; 2\n'
		);
	});
});
