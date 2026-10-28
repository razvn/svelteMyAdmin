import { describe, expect, it } from 'vitest';
import mediawiki from './mediawiki.ts';
import {
	booksConnection,
	createTestContext,
	fixtureData,
	makeExportData,
	FIXTURE_FIELDS
} from './testing.ts';

describe('mediawiki plugin', () => {
	it('has the phpMyAdmin identity', () => {
		expect(mediawiki.id).toBe('mediawiki');
		expect(mediawiki.extension).toBe('mediawiki');
		expect(mediawiki.mimeType).toBe('text/plain');
		expect(mediawiki.supports).toEqual({ structure: true, data: true });
	});

	it('writes the structure table with caption, headers, types, nulls, defaults and extras', async () => {
		const t = createTestContext({}, { conn: booksConnection() });
		await mediawiki.structure?.(t.ctx, fixtureData().ref, 'structure');
		expect(t.text()).toBe(
			[
				'',
				'<!--',
				'Table structure for `books`',
				'-->',
				'',
				'{| class="wikitable" style="text-align:center;"',
				"|+'''books'''",
				'|- style="background:#ffdead;"',
				'! style="background:#ffffff" | ',
				' | id',
				' | author_id',
				' | title',
				' | price',
				' | published_at',
				' | status',
				'|-',
				'! Type',
				' | int unsigned',
				' | int unsigned',
				' | varchar(200)',
				' | decimal(8,2)',
				' | datetime',
				" | enum('draft','published','archived')",
				'|-',
				'! Null',
				' | NO',
				' | NO',
				' | NO',
				' | NO',
				' | YES',
				' | NO',
				'|-',
				'! Default',
				' | ',
				' | ',
				' | ',
				' | 0.00',
				' | ',
				' | draft',
				'|-',
				'! Extra',
				' | auto_increment',
				' | ',
				' | ',
				' | ',
				' | ',
				' | ',
				'|}',
				'',
				''
			].join('\n')
		);
	});

	it('writes no structure for views', async () => {
		const t = createTestContext({}, { conn: booksConnection() });
		await mediawiki.structure?.(t.ctx, { ...fixtureData().ref, kind: 'view' }, 'structure');
		expect(t.text()).toBe('');
	});

	it('writes the data table with a caption, a header row and NULL as an empty cell', async () => {
		const t = createTestContext({});
		await mediawiki.data?.(t.ctx, fixtureData());
		expect(t.text()).toBe(
			[
				'',
				'<!--',
				'Table data for `books`',
				'-->',
				'',
				'{| class="wikitable sortable" style="text-align:center;"',
				"|+'''books'''",
				'|-',
				' ! id',
				' ! name',
				' ! note',
				' ! price',
				' ! payload',
				'|-',
				' | 1',
				' | Plain',
				' | simple',
				' | 9.99',
				' | bin',
				'|-',
				' | 2',
				' | Quote "x", semi;colon',
				' | line one',
				'line two\r',
				'line three',
				' | ',
				' | ',
				'|-',
				' | 3',
				' | Ünïcode ✓ 日本',
				' | tab\there\\back',
				' | 0',
				' | q"',
				'z',
				'|-',
				' | 4',
				" | Apos ' & <tag>",
				' | ',
				' | -12.50',
				' | ',
				'|}',
				'',
				''
			].join('\n')
		);
	});

	it('omits the caption and headers when the options are off, and uses query results for raw', async () => {
		const t = createTestContext({ caption: false, headers: false });
		await mediawiki.data?.(
			t.ctx,
			makeExportData({ table: '', fields: FIXTURE_FIELDS, rows: [['9', 'x', 'y', '1', null]] })
		);
		expect(t.text()).toBe(
			[
				'',
				'<!--',
				'Query results',
				'-->',
				'',
				'{| class="wikitable sortable" style="text-align:center;"',
				'|-',
				' | 9',
				' | x',
				' | y',
				' | 1',
				' | ',
				'|}',
				'',
				''
			].join('\n')
		);
	});
});
