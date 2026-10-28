import { describe, expect, it } from 'vitest';
import csv, { csvCell, csvHeaderLine, csvTerminator, type CsvSettings } from './csv.ts';
import { createTestContext, field, FIXTURE_ROWS, fixtureData, makeExportData } from './testing.ts';

const base: CsvSettings = {
	separator: ',',
	enclosed: '"',
	escaped: '"',
	lineEnd: '\n',
	nullText: 'NULL',
	removeCRLF: false,
	columns: true,
	excel: false
};

async function runCsv(options = {}, rows = FIXTURE_ROWS) {
	const t = createTestContext(options);
	const data = makeExportData({
		fields: fixtureData().fields,
		rows
	});
	await csv.data?.(t.ctx, data);
	return t;
}

describe('csv plugin', () => {
	it('has the phpMyAdmin identity and only exports data', () => {
		expect(csv.id).toBe('csv');
		expect(csv.extension).toBe('csv');
		expect(csv.mimeType).toBe('text/comma-separated-values');
		expect(csv.supports).toEqual({ structure: false, data: true });
	});

	it('writes the header and enclosed values with NULL and empty values as in ExportCsv.php', async () => {
		const t = await runCsv();
		expect(t.text()).toBe(
			[
				'"id","name","note","price","payload"',
				'"1","Plain","simple","9.99","bin"',
				'"2","Quote ""x"", semi;colon","line one',
				'line two\r',
				'line three",NULL,NULL',
				'"3","Ünïcode ✓ 日本","tab	here\\back","0","q""',
				'z"',
				'"4","Apos \' & <tag>",,"-12.50",',
				''
			].join('\n')
		);
	});

	it('uses the terminated option (escape sequences expanded)', async () => {
		const t = await runCsv({ terminated: '\\r\\n' }, [FIXTURE_ROWS[0] ?? []]);
		expect(t.text()).toBe(
			'"id","name","note","price","payload"\r\n"1","Plain","simple","9.99","bin"\r\n'
		);
	});

	it('uses the context line ending for AUTO and honours the separator option', async () => {
		const t = createTestContext({ separator: '\\t' }, { crlf: '\r\n' });
		await csv.data?.(
			t.ctx,
			makeExportData({ fields: [field('a', 'int'), field('b', 'int')], rows: [['1', '2']] })
		);
		expect(t.text()).toBe('"a"\t"b"\r\n"1"\t"2"\r\n');
	});

	it('replaces NULL with the configured text and can drop the header row', async () => {
		const t = await runCsv({ null: 'N/A', columns: false }, [['5', null, null, null, null]]);
		expect(t.text()).toBe('"5",N/A,N/A,N/A,N/A\n');
	});

	it('removes CR and LF inside values when removeCRLF is on', async () => {
		const t = await runCsv({ removeCRLF: true, columns: false }, [FIXTURE_ROWS[1] ?? []]);
		expect(t.text()).toBe('"2","Quote ""x"", semi;colon","line oneline twoline three",NULL,NULL\n');
	});

	it('keeps raw bytes of binary cells (not valid UTF-8)', async () => {
		const t = createTestContext({ columns: false });
		await csv.data?.(
			t.ctx,
			makeExportData({
				fields: [field('b', 'blob', { isBinary: true })],
				rows: [[Buffer.from([0xff, 0x22, 0x00])]]
			})
		);
		expect(t.bytes().equals(Buffer.from([0x22, 0xff, 0x22, 0x22, 0x00, 0x22, 0x0a]))).toBe(true);
	});
});

describe('csv helpers', () => {
	it('csvTerminator: AUTO and empty use the context line ending', () => {
		expect(csvTerminator('AUTO', '\n')).toBe('\n');
		expect(csvTerminator('auto', '\r\n')).toBe('\r\n');
		expect(csvTerminator('', '\n')).toBe('\n');
		expect(csvTerminator('\\n', '\r\n')).toBe('\n');
	});

	it('csvHeaderLine only doubles the enclosure character and trims the line', () => {
		expect(csvHeaderLine(['a"b', 'c'], base)).toBe('"a""b","c"');
		expect(csvHeaderLine(['  x  ', 'y'], { ...base, enclosed: '' })).toBe('x  ,y');
	});

	it('csvCell escapes the escape character before the enclosure (escaped differs)', () => {
		const pieces = csvCell('a\\"b', { ...base, escaped: '\\' });
		expect(pieces.join('')).toBe('"a\\\\\\"b"');
	});

	it('csvCell: empty value produces nothing, NULL the null text', () => {
		expect(csvCell('', base)).toEqual([]);
		expect(csvCell(null, base)).toEqual(['NULL']);
	});
});
