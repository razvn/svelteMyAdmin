/** Test helpers for the binary export plugins (fake ExportContext, row streams, PDF text extraction). */
import { unzlibSync, unzipSync, strFromU8 } from 'fflate';
import type { Connection } from '#lib/server/db/connection.ts';
import type {
	ExportCell,
	ExportContext,
	ExportData,
	ExportField,
	ExportOptionValues,
	ExportPlugin,
	ExportTableRef
} from '#lib/server/export/types.ts';

export interface FakeContext {
	ctx: ExportContext;
	/** Everything written, concatenated. */
	bytes(): Uint8Array;
}

export function fakeContext(
	options: ExportOptionValues = {},
	conn: unknown = {},
	scope: ExportContext['scope'] = 'table'
): FakeContext {
	const chunks: Uint8Array[] = [];
	const ctx: ExportContext = {
		async write(chunk) {
			chunks.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk);
		},
		conn: conn as Connection,
		scope,
		options,
		crlf: '\n',
		server: { version: '8.4.0', isMariaDb: false, host: 'localhost' },
		appVersion: '0.0.0-test',
		now: new Date('2024-03-05T10:20:30Z')
	};
	return {
		ctx,
		bytes() {
			const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
			let o = 0;
			for (const c of chunks) {
				out.set(c, o);
				o += c.length;
			}
			return out;
		}
	};
}

export async function* rowsOf(rows: ExportCell[][]): AsyncGenerator<ExportCell[]> {
	for (const r of rows) yield r;
}

export function field(name: string, type: string, extra: Partial<ExportField> = {}): ExportField {
	return {
		name,
		type,
		isBinary: false,
		isNumeric: /int|decimal|float|double|year/.test(type),
		nullable: true,
		...extra
	};
}

export function dataOf(
	table: string,
	fields: ExportField[],
	rows: ExportCell[][],
	alias = ''
): ExportData {
	const ref: ExportTableRef = { db: 'd', table, alias, kind: 'table' };
	return { ref, fields, rows: rowsOf(rows), sql: `SELECT * FROM ${table}` };
}

/** Run a whole plugin: header, hooks, footer; returns the produced bytes. */
export async function runPlugin(
	plugin: ExportPlugin,
	fc: FakeContext,
	hooks: (ctx: ExportContext) => Promise<void>
): Promise<Uint8Array> {
	await plugin.header?.(fc.ctx);
	await hooks(fc.ctx);
	await plugin.footer?.(fc.ctx);
	return fc.bytes();
}

export interface ZipEntry {
	name: string;
	/** Compression method from the local header: 0 stored, 8 deflate. */
	method: number;
}

/** Entry names and compression methods in physical (local header) order. */
export function listZip(zip: Uint8Array): ZipEntry[] {
	const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
	const out: ZipEntry[] = [];
	let p = 0;
	while (p + 30 <= zip.length && dv.getUint32(p, true) === 0x04034b50) {
		const method = dv.getUint16(p + 8, true);
		const csize = dv.getUint32(p + 18, true);
		const nlen = dv.getUint16(p + 26, true);
		const elen = dv.getUint16(p + 28, true);
		out.push({ name: strFromU8(zip.subarray(p + 30, p + 30 + nlen)), method });
		p += 30 + nlen + elen + csize;
	}
	return out;
}

export function unzipText(zip: Uint8Array): Record<string, string> {
	return Object.fromEntries(Object.entries(unzipSync(zip)).map(([k, v]) => [k, strFromU8(v)]));
}

function fromUtf16(hex: string): string {
	const units = (hex.match(/.{4}/g) ?? []).map((h) => parseInt(h, 16));
	return String.fromCharCode(...units);
}

/** Text lines of a pdfkit PDF using an embedded TrueType font (Identity-H + ToUnicode). */
export function pdfText(pdf: Uint8Array): string[] {
	const raw = Buffer.from(pdf).toString('latin1');
	const map = new Map<number, string>();
	const contents: string[] = [];
	for (const m of raw.matchAll(/stream\r?\n/g)) {
		const start = m.index + m[0].length;
		const end = raw.indexOf('endstream', start);
		if (end < 0) continue;
		let text: string;
		try {
			text = Buffer.from(unzlibSync(pdf.subarray(start, end))).toString('latin1');
		} catch {
			continue;
		}
		if (text.includes('begincmap')) {
			for (const sec of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
				for (const c of sec[1].matchAll(/<([0-9a-f]+)>\s*<([0-9a-f]+)>/gi)) {
					map.set(parseInt(c[1], 16), fromUtf16(c[2]));
				}
			}
			for (const sec of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
				for (const r of sec[1].matchAll(
					/<([0-9a-f]+)>\s*<([0-9a-f]+)>\s*(\[[^\]]*\]|<[0-9a-f]+>)/gi
				)) {
					const lo = parseInt(r[1], 16);
					const hi = parseInt(r[2], 16);
					if (r[3].startsWith('[')) {
						[...r[3].matchAll(/<([0-9a-f ]+)>/gi)].forEach((u, k) =>
							map.set(lo + k, fromUtf16(u[1].replace(/ /g, '')))
						);
					} else {
						const base = parseInt(r[3].slice(1, -1), 16);
						for (let g = lo; g <= hi; g++) map.set(g, String.fromCodePoint(base + g - lo));
					}
				}
			}
		} else if (/\bBT\b/.test(text)) contents.push(text);
	}
	const decode = (hex: string) =>
		(hex.match(/.{4}/g) ?? []).map((g) => map.get(parseInt(g, 16)) ?? '?').join('');
	const lines: string[] = [];
	for (const page of contents) {
		for (const bt of page.matchAll(/BT([\s\S]*?)ET/g)) {
			let line = '';
			for (const s of bt[1].matchAll(/<([0-9a-f]+)>/gi)) line += decode(s[1]);
			if (line) lines.push(line);
		}
	}
	return lines;
}

export function pdfPageCount(pdf: Uint8Array): number {
	const raw = Buffer.from(pdf).toString('latin1');
	return (raw.match(/\/Type \/Page\b(?!s)/g) ?? []).length;
}
