/**
 * Turning an uploaded byte stream into text: compression detection (extension and magic bytes),
 * gzip through zlib, zip through fflate (first file of the archive), charset decoding.
 * bzip2 is not supported (no pure JS decoder is bundled).
 */
import { N_ } from '#lib/i18n/translator.ts';
import { once } from 'node:events';
import { createGunzip } from 'node:zlib';
import { Unzip, UnzipInflate } from 'fflate';
import { parseFileName, type FileNameInfo } from '#lib/import/filename.ts';
import type { Compression, ImportFormat } from '#lib/import/types.ts';

/** A failure that is the user's to fix: reported as the import message, not as a server error. */
export class ImportAbort extends Error {
	/** `message` is an English msgid (mark with N_); the orchestrator translates it with `params`. */
	constructor(
		message: string,
		readonly params?: Record<string, string | number>
	) {
		super(message);
		this.name = 'ImportAbort';
	}
}

export { parseFileName, type FileNameInfo };

export function detectBySignature(head: Uint8Array): Compression {
	if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) return 'gzip';
	if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && head[2] === 3 && head[3] === 4) {
		return 'zip';
	}
	if (head.length >= 3 && head[0] === 0x42 && head[1] === 0x5a && head[2] === 0x68) return 'bzip2';
	return 'none';
}

export async function* streamChunks(
	stream: ReadableStream<Uint8Array>
): AsyncGenerator<Uint8Array> {
	const reader = stream.getReader();
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) return;
			if (value && value.length > 0) yield value;
		}
	} finally {
		reader.releaseLock();
	}
}

async function* gunzip(src: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
	const gz = createGunzip();
	const feed = (async () => {
		try {
			for await (const c of src) {
				if (!gz.write(c)) await once(gz, 'drain');
			}
			gz.end();
		} catch (e) {
			gz.destroy(e as Error);
		}
	})();
	try {
		for await (const out of gz) yield out as Uint8Array;
	} catch {
		throw new ImportAbort(N_('The file could not be decompressed (invalid gzip data).'));
	} finally {
		gz.destroy();
		await feed.catch(() => {});
	}
}

async function* unzipFirst(src: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
	const unzip = new Unzip();
	unzip.register(UnzipInflate);
	const queue: Uint8Array[] = [];
	let chosen = false;
	let done = false;
	let failure: Error | null = null;
	unzip.onfile = (file) => {
		if (chosen || file.name.endsWith('/')) return;
		chosen = true;
		file.ondata = (err, chunk, final) => {
			if (err) failure = err;
			else if (chunk.length > 0) queue.push(chunk);
			if (final) done = true;
		};
		try {
			file.start();
		} catch (e) {
			failure = e as Error;
		}
	};
	const fail = () => {
		throw new ImportAbort(N_('The ZIP archive could not be read: {reason}'), {
			reason: (failure as Error | null)?.message ?? 'invalid data'
		});
	};
	try {
		for await (const c of src) {
			if (done) continue; // drain the rest of the upload
			unzip.push(c);
			if (failure) fail();
			while (queue.length > 0) yield queue.shift()!;
		}
		if (!done) unzip.push(new Uint8Array(0), true);
	} catch (e) {
		if (e instanceof ImportAbort) throw e;
		throw new ImportAbort(N_('The ZIP archive could not be read: {reason}'), {
			reason: (e as Error).message
		});
	}
	if (failure) fail();
	while (queue.length > 0) yield queue.shift()!;
	if (!chosen) throw new ImportAbort(N_('The ZIP archive contains no file.'));
}

async function* rechain(first: Uint8Array, it: AsyncIterator<Uint8Array>) {
	yield first;
	for (;;) {
		const r = await it.next();
		if (r.done) return;
		yield r.value;
	}
}

export interface PreparedSource {
	/** Decompressed bytes. */
	bytes: AsyncIterable<Uint8Array>;
	compression: Compression;
	format: ImportFormat | null;
	innerName: string;
}

/**
 * Detect the compression of the stream and return the decompressed bytes.
 * @param formatHint format chosen in the form (`auto` => from the name)
 */
export async function prepareSource(
	input: AsyncIterable<Uint8Array>,
	fileName: string,
	formatHint: ImportFormat | 'auto'
): Promise<PreparedSource> {
	const info = parseFileName(fileName);
	const it = input[Symbol.asyncIterator]();
	const first = await it.next();
	const chained: AsyncIterable<Uint8Array> = first.done
		? (async function* () {})()
		: rechain(first.value, it);
	const format = formatHint === 'auto' ? info.format : formatHint;

	let compression = info.compression;
	if (compression === 'none' && !first.done && format !== 'ods') {
		compression = detectBySignature(first.value);
	}
	if (compression === 'bzip2') {
		throw new ImportAbort(
			N_('bzip2 compressed files are not supported. Decompress the file first, or use gzip or zip.')
		);
	}
	const bytes =
		compression === 'gzip'
			? gunzip(chained)
			: compression === 'zip'
				? unzipFirst(chained)
				: chained;
	return { bytes, compression, format, innerName: info.innerName };
}

/** Decode bytes with a WHATWG encoding label (a BOM is removed). */
export async function* decodeText(
	bytes: AsyncIterable<Uint8Array>,
	charset: string
): AsyncGenerator<string> {
	const decoder = new TextDecoder(charset || 'utf-8');
	for await (const chunk of bytes) {
		const s = decoder.decode(chunk, { stream: true });
		if (s !== '') yield s;
	}
	const tail = decoder.decode();
	if (tail !== '') yield tail;
}

export async function collectBytes(
	bytes: AsyncIterable<Uint8Array>,
	limit: number
): Promise<Uint8Array> {
	const parts: Uint8Array[] = [];
	let total = 0;
	for await (const c of bytes) {
		total += c.length;
		if (total > limit) throw memoryAbort(limit);
		parts.push(c);
	}
	const out = new Uint8Array(total);
	let off = 0;
	for (const p of parts) {
		out.set(p, off);
		off += p.length;
	}
	return out;
}

export async function collectText(text: AsyncIterable<string>, limit: number): Promise<string> {
	let out = '';
	for await (const s of text) {
		out += s;
		if (out.length > limit) throw memoryAbort(limit);
	}
	return out;
}

export const memoryAbort = (limit: number): ImportAbort =>
	new ImportAbort(
		N_(
			'This format is read into memory and the file is larger than the allowed {mib} MiB (MemoryLimit).'
		),
		{ mib: Math.round(limit / 1048576) }
	);
