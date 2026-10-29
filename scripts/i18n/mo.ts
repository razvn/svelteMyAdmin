/**
 * Minimal GNU gettext .mo reader.
 *
 * Layout: magic 0x950412de (little endian; 0xde120495 when read in the other byte order), revision,
 * number of strings N, offset of the original-strings table, offset of the translation table. Each table
 * has N (length, offset) pairs. An original may be `msgctxt \u0004 msgid` and/or `msgid \u0000 msgid_plural`;
 * a translation holds the plural forms separated by `\u0000`. The entry with the empty msgid carries the
 * header (charset, Plural-Forms).
 */

export interface MoEntry {
	context?: string;
	msgid: string;
	/** English plural (msgid_plural), when the entry has plural forms. */
	plural?: string;
	/** Translations; several for plural entries, in gettext plural-form order. */
	forms: string[];
}

export interface PluralForms {
	nplurals: number;
	/** C expression over `n`, e.g. `n > 1` or `(n%10==1 && n%100!=11 ? 0 : 1)`. */
	expr: string;
}

export interface MoFile {
	header: Record<string, string>;
	pluralForms: PluralForms | null;
	entries: MoEntry[];
}

export function parseMo(input: Uint8Array): MoFile {
	const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
	if (input.byteLength < 28) throw new Error('Not a .mo file: too short');
	const magic = view.getUint32(0, true);
	let little: boolean;
	if (magic === 0x950412de) little = true;
	else if (magic === 0xde120495) little = false;
	else throw new Error('Not a .mo file: bad magic number');

	const count = view.getUint32(8, little);
	const originals = view.getUint32(12, little);
	const translations = view.getUint32(16, little);
	const bytes = (table: number, i: number) => {
		const length = view.getUint32(table + i * 8, little);
		const offset = view.getUint32(table + i * 8 + 4, little);
		return input.subarray(offset, offset + length);
	};

	// The charset is declared in the header entry; everything we ship is UTF-8.
	const decoders = new Map<string, TextDecoder>();
	let decoder = new TextDecoder('utf-8');
	const header: Record<string, string> = {};
	const entries: MoEntry[] = [];

	for (let i = 0; i < count; i++) {
		const original = decoder.decode(bytes(originals, i));
		const translation = decoder.decode(bytes(translations, i));
		if (original === '') {
			for (const line of translation.split('\n')) {
				const c = line.indexOf(':');
				if (c > 0) header[line.slice(0, c).trim()] = line.slice(c + 1).trim();
			}
			const charset = /charset=([^\s;]+)/i.exec(header['Content-Type'] ?? '')?.[1];
			if (charset && charset.toLowerCase() !== 'utf-8') {
				decoder = decoders.get(charset) ?? new TextDecoder(charset);
				decoders.set(charset, decoder);
			}
			continue;
		}
		let context: string | undefined;
		let id = original;
		const ctx = id.indexOf('\u0004');
		if (ctx >= 0) {
			context = id.slice(0, ctx);
			id = id.slice(ctx + 1);
		}
		let plural: string | undefined;
		const nul = id.indexOf('\u0000');
		if (nul >= 0) {
			plural = id.slice(nul + 1);
			id = id.slice(0, nul);
		}
		entries.push({ context, msgid: id, plural, forms: translation.split('\u0000') });
	}

	const m = /nplurals\s*=\s*(\d+)\s*;\s*plural\s*=\s*([^;]+)/.exec(header['Plural-Forms'] ?? '');
	const pluralForms = m ? { nplurals: Number(m[1]), expr: m[2].trim() } : null;
	return { header, pluralForms, entries };
}

/** Compile a gettext plural expression into `n -> form index`. Only plain C arithmetic is accepted. */
export function compilePlural(expr: string): (n: number) => number {
	if (!/^[n0-9\s%!=<>&|?:()+\-*/]+$/.test(expr))
		throw new Error(`Unsupported plural expression: ${expr}`);
	const fn = new Function('n', `return Number(${expr});`) as (n: number) => number;
	return (n) => fn(n) | 0;
}
