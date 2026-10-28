/**
 * Output pipeline of an export: plugin text/bytes -> charset -> compression (none/gzip/zip) -> a
 * back-pressured byte stream. `write()` resolves when the consumer has room, so a slow download
 * slows the MySQL stream down instead of buffering.
 */
import { PassThrough, Readable } from 'node:stream';
import { createGzip } from 'node:zlib';
import { Zip, ZipDeflate } from 'fflate';
import iconv from 'iconv-lite';
import type { Compression } from './filename.ts';

/** Charsets of the export form (phpMyAdmin Charsets::$mysqlCharsetMap keys we can encode). */
export const EXPORT_CHARSETS: Record<string, string> = {
	'utf-8': 'utf8',
	'iso-8859-1': 'latin1',
	'iso-8859-2': 'latin2',
	'iso-8859-7': 'greek',
	'iso-8859-15': 'latin1',
	'windows-1250': 'cp1250',
	'windows-1251': 'cp1251',
	'windows-1252': 'latin1',
	'windows-1256': 'cp1256',
	'koi8-r': 'koi8r',
	shift_jis: 'sjis',
	'euc-jp': 'ujis',
	'euc-kr': 'euckr',
	gbk: 'gbk',
	gb2312: 'gb2312',
	big5: 'big5',
	'us-ascii': 'ascii'
};

export function normalizeCharset(charset: string | undefined): string {
	const c = (charset ?? '').toLowerCase();
	return c in EXPORT_CHARSETS ? c : 'utf-8';
}

export interface Sink {
	/** Encoded stream of the (compressed) output. */
	readable: Readable;
	write(chunk: string | Uint8Array): Promise<void>;
	/** Flush and close. */
	end(): Promise<void>;
	/** Abort (consumer gone or export failed). */
	destroy(error?: Error): void;
	/** Resolves after the first chunk was written, at end or on abort (used to surface early errors as HTTP errors). */
	firstOutput: Promise<void>;
}

export function createSink(options: {
	compression: Compression;
	charset: string;
	/** Name of the single file inside a zip archive. */
	zipEntryName: string;
}): Sink {
	const charset = normalizeCharset(options.charset);
	const out = new PassThrough({ highWaterMark: 256 * 1024 });
	const encoder = charset === 'utf-8' ? null : iconv.getEncoder(charset);

	let closed = false;
	out.once('close', () => (closed = true));

	let resolveFirst!: () => void;
	const firstOutput = new Promise<void>((r) => (resolveFirst = r));
	out.once('close', () => resolveFirst());

	// the compressor writes into `out`; `push` feeds it
	let push: (bytes: Uint8Array) => Promise<void>;
	let finish: () => Promise<void>;

	const waitDrain = (stream: PassThrough | ReturnType<typeof createGzip>) =>
		new Promise<void>((resolve, reject) => {
			if (closed) return reject(new Error('Output closed'));
			const onDrain = () => {
				cleanup();
				resolve();
			};
			const onClose = () => {
				cleanup();
				reject(new Error('Output closed'));
			};
			const cleanup = () => {
				stream.off('drain', onDrain);
				out.off('close', onClose);
			};
			stream.once('drain', onDrain);
			out.once('close', onClose);
		});

	if (options.compression === 'gzip') {
		const gz = createGzip();
		gz.pipe(out);
		gz.on('error', (e) => out.destroy(e));
		push = async (bytes) => {
			if (closed) throw new Error('Output closed');
			if (!gz.write(bytes)) await waitDrain(gz);
		};
		finish = () =>
			new Promise<void>((resolve) => {
				out.once('finish', () => resolve());
				gz.end();
			});
	} else if (options.compression === 'zip') {
		const zip = new Zip((err, data, final) => {
			if (err) return out.destroy(err);
			out.write(data);
			if (final) out.end();
		});
		const entry = new ZipDeflate(options.zipEntryName, { level: 6 });
		zip.add(entry);
		push = async (bytes) => {
			if (closed) throw new Error('Output closed');
			entry.push(bytes);
			if (out.writableNeedDrain) await waitDrain(out);
		};
		finish = () =>
			new Promise<void>((resolve) => {
				out.once('finish', () => resolve());
				entry.push(new Uint8Array(0), true);
				zip.end();
			});
	} else {
		push = async (bytes) => {
			if (closed) throw new Error('Output closed');
			if (!out.write(bytes)) await waitDrain(out);
		};
		finish = () =>
			new Promise<void>((resolve) => {
				out.once('finish', () => resolve());
				out.end();
			});
	}

	return {
		readable: out,
		firstOutput,
		async write(chunk) {
			let bytes: Uint8Array;
			if (typeof chunk === 'string') {
				if (chunk === '') return;
				bytes = encoder ? new Uint8Array(encoder.write(chunk) ?? []) : Buffer.from(chunk, 'utf8');
			} else {
				bytes = chunk;
			}
			if (bytes.length === 0) return;
			await push(bytes);
			resolveFirst();
		},
		async end() {
			if (encoder) {
				const rest = encoder.end();
				if (rest && rest.length) await push(new Uint8Array(rest));
			}
			await finish();
			resolveFirst();
		},
		destroy(error) {
			out.destroy(error);
		}
	};
}
