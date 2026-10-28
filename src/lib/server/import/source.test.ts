import { gzipSync } from 'node:zlib';
import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { maxUploadBytes, memoryLimitBytes, parseByteSize, timeBudgetMs } from './limits.ts';
import { parseFileName as parseHeaderName, parseRequestOptions, parseScope } from './request.ts';
import {
	collectBytes,
	decodeText,
	detectBySignature,
	ImportAbort,
	parseFileName,
	prepareSource
} from './source.ts';

async function* chunks(data: Uint8Array, size: number): AsyncGenerator<Uint8Array> {
	for (let i = 0; i < data.length; i += size) yield data.subarray(i, i + size);
}
const text = async (it: AsyncIterable<Uint8Array>, charset = 'utf-8') => {
	let s = '';
	for await (const t of decodeText(it, charset)) s += t;
	return s;
};

describe('file names', () => {
	it('splits compression and format', () => {
		expect(parseFileName('dump.sql.gz')).toMatchObject({ compression: 'gzip', format: 'sql' });
		expect(parseFileName('data.CSV.zip')).toMatchObject({ compression: 'zip', format: 'csv' });
		expect(parseFileName('x.xml.bz2')).toMatchObject({ compression: 'bzip2', format: 'xml' });
		expect(parseFileName('sheet.ods')).toMatchObject({ compression: 'none', format: 'ods' });
		expect(parseFileName('wiki.txt')).toMatchObject({ format: 'mediawiki' });
		expect(parseFileName('noext')).toMatchObject({ compression: 'none', format: null });
		expect(parseFileName('C:\\tmp\\a.sql')).toMatchObject({ innerName: 'a.sql' });
	});
	it('detects signatures', () => {
		expect(detectBySignature(Uint8Array.of(0x1f, 0x8b, 8))).toBe('gzip');
		expect(detectBySignature(Uint8Array.of(0x50, 0x4b, 3, 4))).toBe('zip');
		expect(detectBySignature(strToU8('BZh9'))).toBe('bzip2');
		expect(detectBySignature(strToU8('SELECT'))).toBe('none');
	});
});

describe('prepareSource', () => {
	const sql = "INSERT INTO t VALUES ('é');\n".repeat(2000);

	it('passes plain data through', async () => {
		const s = await prepareSource(chunks(strToU8(sql), 777), 'a.sql', 'auto');
		expect(s.compression).toBe('none');
		expect(s.format).toBe('sql');
		expect(await text(s.bytes)).toBe(sql);
	});

	it('gunzips by extension and by magic bytes', async () => {
		const gz = new Uint8Array(gzipSync(strToU8(sql)));
		for (const name of ['a.sql.gz', 'renamed.sql']) {
			const s = await prepareSource(chunks(gz, 100), name, 'auto');
			expect(s.compression).toBe('gzip');
			expect(await text(s.bytes)).toBe(sql);
		}
	});

	it('reads the first file of a zip, streaming in small chunks', async () => {
		const zip = zipSync({
			'dir/': new Uint8Array(0),
			'first.sql': strToU8(sql),
			'second.sql': strToU8('x')
		});
		for (const size of [7, 1000, zip.length]) {
			const s = await prepareSource(chunks(zip, size), 'bundle.zip', 'sql');
			expect(s.compression).toBe('zip');
			expect(await text(s.bytes)).toBe(sql);
		}
	});

	it('a .ods stays a zip for the ODS reader', async () => {
		const zip = zipSync({ 'content.xml': strToU8('x') });
		const s = await prepareSource(chunks(zip, 50), 'a.ods', 'auto');
		expect(s.compression).toBe('none');
		expect(await collectBytes(s.bytes, 1 << 20)).toEqual(zip);
	});

	it('bzip2 and corrupt data produce a clear message', async () => {
		await expect(prepareSource(chunks(strToU8('x'), 1), 'a.sql.bz2', 'auto')).rejects.toThrow(
			/bzip2/
		);
		const s = await prepareSource(
			chunks(Uint8Array.of(0x1f, 0x8b, 1, 2, 3, 4), 2),
			'a.sql',
			'auto'
		);
		await expect(text(s.bytes)).rejects.toBeInstanceOf(ImportAbort);
	});

	it('enforces the memory cap', async () => {
		await expect(collectBytes(chunks(new Uint8Array(100), 10), 50)).rejects.toThrow(/MemoryLimit/);
	});
});

describe('charset decoding', () => {
	it('decodes latin1 / windows-1252 and removes a BOM, across chunk splits', async () => {
		expect(await text(chunks(Uint8Array.of(0x63, 0x61, 0x66, 0xe9), 1), 'iso-8859-1')).toBe('café');
		expect(await text(chunks(strToU8('\ufeffa€b'), 2))).toBe('a€b');
	});
});

describe('limits', () => {
	it('parses sizes', () => {
		expect(parseByteSize('512K')).toBe(512 * 1024);
		expect(parseByteSize('10M')).toBe(10 * 1048576);
		expect(parseByteSize('2G')).toBe(2 * 1024 ** 3);
		expect(parseByteSize('1000')).toBe(1000);
		expect(parseByteSize('Infinity')).toBeUndefined();
		expect(parseByteSize('-1')).toBeUndefined();
		expect(parseByteSize('junk')).toBeUndefined();
	});
	it('combines BODY_SIZE_LIMIT and Import.max_upload_size', () => {
		expect(maxUploadBytes({}, {})).toBeUndefined();
		expect(maxUploadBytes({}, { BODY_SIZE_LIMIT: '5M' })).toBe(5 * 1048576);
		expect(maxUploadBytes({ max_upload_size: '1M' }, { BODY_SIZE_LIMIT: '5M' })).toBe(1048576);
		expect(maxUploadBytes({ max_upload_size: 2048 }, {})).toBe(2048);
	});
	it('time budget leaves 5 seconds like phpMyAdmin', () => {
		expect(timeBudgetMs(300)).toBe(295_000);
		expect(timeBudgetMs(0)).toBe(0);
		expect(timeBudgetMs(4)).toBe(3200);
	});
	it('memory limit falls back to the built-in cap', () => {
		expect(memoryLimitBytes('-1')).toBe(512 * 1048576);
		expect(memoryLimitBytes('64M')).toBe(64 * 1048576);
	});
});

describe('request parsing', () => {
	it('scopes', () => {
		expect(parseScope(new URLSearchParams(''))).toEqual({ level: 'server' });
		expect(parseScope(new URLSearchParams('db=a'))).toEqual({ level: 'db', db: 'a' });
		expect(parseScope(new URLSearchParams('db=a&table=b'))).toEqual({
			level: 'table',
			db: 'a',
			table: 'b'
		});
		expect(parseScope(new URLSearchParams('table=b'))).toBeNull();
	});
	it('options', () => {
		const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o));
		expect(parseRequestOptions(null)).toMatchObject({
			format: 'auto',
			skipQueries: 0,
			fkChecks: true
		});
		expect(
			parseRequestOptions(enc({ format: 'csv', skip_queries: 3, options: { terminated: ';' } }))
		).toMatchObject({ format: 'csv', skipQueries: 3, options: { terminated: ';' } });
		expect(parseRequestOptions(enc({ format: 'exe' }))).toBeNull();
		expect(parseRequestOptions(enc({ charset: 'klingon' }))).toBeNull();
		expect(parseRequestOptions('%')).toBeNull();
		expect(parseHeaderName(encodeURIComponent('dir/ü file.sql'))).toBe('ü file.sql');
		expect(parseHeaderName(null)).toBeNull();
	});
});
