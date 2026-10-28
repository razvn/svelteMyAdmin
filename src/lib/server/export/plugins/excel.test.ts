import { describe, expect, it } from 'vitest';
import excel from './excel.ts';
import { createTestContext, FIXTURE_ROWS, fixtureData } from './testing.ts';

async function run(options: Record<string, string | boolean> = {}) {
	const t = createTestContext(options);
	await excel.data?.(t.ctx, fixtureData());
	return t;
}

describe('excel plugin', () => {
	it('is the "CSV for MS Excel" format with CRLF lines', () => {
		expect(excel.label).toBe('CSV for MS Excel');
		expect(excel.extension).toBe('csv');
		expect(excel.crlf).toBe('\r\n');
	});

	it('uses ";" for Windows and writes CRLF, CR/CRLF inside values become LF', async () => {
		const t = await run();
		expect(t.text()).toBe(
			[
				'"id";"name";"note";"price";"payload"',
				'"1";"Plain";"simple";"9.99";"bin"',
				'"2";"Quote ""x"", semi;colon";"line one\nline two\nline three";NULL;NULL',
				'"3";"Ünïcode ✓ 日本";"tab\there\\back";"0";"q""\nz"',
				'"4";"Apos \' & <tag>";;"-12.50";',
				''
			].join('\r\n')
		);
	});

	it('uses ";" for Excel 2003 for Macintosh and "," for Excel 2008 for Macintosh', async () => {
		const mac2003 = await run({ edition: 'mac_excel2003', columns: false });
		expect(mac2003.text().split('\r\n')[0]).toBe('"1";"Plain";"simple";"9.99";"bin"');
		const mac2008 = await run({ edition: 'mac_excel2008', columns: false });
		expect(mac2008.text().split('\r\n')[0]).toBe('"1","Plain","simple","9.99","bin"');
	});

	it('honours the NULL text, the columns row and removeCRLF', async () => {
		const t = await run({ null: '', removeCRLF: true, columns: false });
		const lines = t.text().split('\r\n');
		expect(lines[1]).toBe('"2";"Quote ""x"", semi;colon";"line oneline twoline three";;');
		expect(lines).toHaveLength(5);
		expect(lines[0]?.startsWith('"1"')).toBe(true);
	});

	it('writes no byte order mark (as phpMyAdmin 5.2.3 does)', async () => {
		const t = await run({ columns: false });
		expect(
			t
				.bytes()
				.subarray(0, 3)
				.equals(Buffer.from([0xef, 0xbb, 0xbf]))
		).toBe(false);
		expect(FIXTURE_ROWS).toHaveLength(4);
	});
});
