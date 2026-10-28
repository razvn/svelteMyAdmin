import { describe, expect, it } from 'vitest';
import htmlword, { HTMLWORD_HEADER } from './htmlword.ts';
import { booksConnection, createTestContext, fixtureData } from './testing.ts';

describe('htmlword plugin', () => {
	it('has the phpMyAdmin identity and no raw scope', () => {
		expect(htmlword.id).toBe('htmlword');
		expect(htmlword.extension).toBe('doc');
		expect(htmlword.mimeType).toBe('application/vnd.ms-word');
		expect(htmlword.scopes).toEqual(['server', 'database', 'table']);
	});

	it('starts with the Word-compatible prologue and closes the body', async () => {
		const t = createTestContext({});
		await htmlword.header?.(t.ctx);
		await htmlword.footer?.(t.ctx);
		expect(t.text()).toBe(HTMLWORD_HEADER + '</body></html>');
		expect(HTMLWORD_HEADER).toContain('content="text/html;charset=utf-8"');
	});

	it('writes the structure table with the print classes, markers and defaults', async () => {
		const t = createTestContext({}, { conn: booksConnection() });
		await htmlword.structure?.(t.ctx, fixtureData().ref, 'structure');
		expect(t.text()).toBe(
			'<h2>Table structure for table books</h2>' +
				'<table width="100%" cellspacing="1">' +
				'<tr class="print-category"><th class="print">Column</th>' +
				'<td class="print"><strong>Type</strong></td>' +
				'<td class="print"><strong>Null</strong></td>' +
				'<td class="print"><strong>Default</strong></td></tr>' +
				'<tr class="print-category"><td class="print"><em><strong>id</strong></em></td><td class="print">int</td><td class="print">No</td><td class="print"></td></tr>' +
				'<tr class="print-category"><td class="print">author_id</td><td class="print">int</td><td class="print">No</td><td class="print"></td></tr>' +
				'<tr class="print-category"><td class="print"><strong>title</strong></td><td class="print">varchar(200)</td><td class="print">No</td><td class="print"></td></tr>' +
				'<tr class="print-category"><td class="print">price</td><td class="print">decimal(8,2)</td><td class="print">No</td><td class="print">0.00</td></tr>' +
				'<tr class="print-category"><td class="print">published_at</td><td class="print">datetime</td><td class="print">Yes</td><td class="print">NULL</td></tr>' +
				'<tr class="print-category"><td class="print">status</td><td class="print">enum(&#039;draft&#039;, &#039;published&#039;, &#039;archived&#039;)</td><td class="print">No</td><td class="print">draft</td></tr>' +
				'</table>'
		);
	});

	it('writes the data table with the column row, NULL text and escaped values', async () => {
		const t = createTestContext({ columns: true });
		await htmlword.data?.(t.ctx, fixtureData());
		expect(t.text()).toBe(
			'<h2>Dumping data for table books</h2><table width="100%" cellspacing="1">' +
				'<tr class="print-category">' +
				'<td class="print"><strong>id</strong></td>' +
				'<td class="print"><strong>name</strong></td>' +
				'<td class="print"><strong>note</strong></td>' +
				'<td class="print"><strong>price</strong></td>' +
				'<td class="print"><strong>payload</strong></td></tr>' +
				'<tr class="print-category"><td class="print">1</td><td class="print">Plain</td><td class="print">simple</td><td class="print">9.99</td><td class="print">bin</td></tr>' +
				'<tr class="print-category"><td class="print">2</td><td class="print">Quote &quot;x&quot;, semi;colon</td><td class="print">line one\nline two\r\nline three</td><td class="print">NULL</td><td class="print">NULL</td></tr>' +
				'<tr class="print-category"><td class="print">3</td><td class="print">Ünïcode ✓ 日本</td><td class="print">tab\there\\back</td><td class="print">0</td><td class="print">q&quot;\nz</td></tr>' +
				'<tr class="print-category"><td class="print">4</td><td class="print">Apos &#039; &amp; &lt;tag&gt;</td><td class="print"></td><td class="print">-12.50</td><td class="print"></td></tr>' +
				'</table>'
		);
	});

	it('writes the database heading', async () => {
		const t = createTestContext({});
		await htmlword.dbHeader?.(t.ctx, 'sma_test', '');
		expect(t.text()).toBe('<h1>Database sma_test</h1>');
	});
});
