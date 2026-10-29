/** Address converters (Utils/FormatConverter.php): inet_pton / inet_ntop, ip2long / long2ip. */

export const toHex = (bytes: Uint8Array): string =>
	Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

function parseV4(s: string): number[] | null {
	const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
	if (!m) return null;
	const parts = m.slice(1).map((p) => (p.length > 1 && p.startsWith('0') ? NaN : Number(p)));
	return parts.every((n) => n >= 0 && n <= 255) ? parts : null;
}

/** inet_pton(): 4 bytes for IPv4, 16 for IPv6, null when invalid. */
export function inetPton(s: string): Uint8Array | null {
	const v4 = parseV4(s);
	if (v4) return Uint8Array.from(v4);
	if (!s.includes(':') || !/^[0-9a-fA-F:.]+$/.test(s)) return null;
	let text = s;
	let tail: number[] = [];
	if (text.includes('.')) {
		const lastColon = text.lastIndexOf(':');
		const v = parseV4(text.slice(lastColon + 1));
		if (!v) return null;
		tail = v;
		text = text.slice(0, lastColon + 1) + '0:0';
	}
	const halves = text.split('::');
	if (halves.length > 2) return null;
	const group = (part: string): number[] | null => {
		if (part === '') return [];
		const out: number[] = [];
		for (const g of part.split(':')) {
			if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
			out.push(Number.parseInt(g, 16));
		}
		return out;
	};
	const head = group(halves[0]);
	const rest = halves.length === 2 ? group(halves[1]) : [];
	if (!head || !rest) return null;
	let words: number[];
	if (halves.length === 2) {
		const fill = 8 - head.length - rest.length;
		if (fill < 1) return null;
		words = [...head, ...Array<number>(fill).fill(0), ...rest];
	} else {
		if (head.length !== 8) return null;
		words = head;
	}
	if (tail.length) {
		words[6] = (tail[0] << 8) | tail[1];
		words[7] = (tail[2] << 8) | tail[3];
	}
	const out = new Uint8Array(16);
	words.forEach((w, i) => {
		out[i * 2] = w >> 8;
		out[i * 2 + 1] = w & 255;
	});
	return out;
}

/** inet_ntop(): null when the length is neither 4 nor 16. */
export function inetNtop(bytes: Uint8Array): string | null {
	if (bytes.length === 4) return Array.from(bytes).join('.');
	if (bytes.length !== 16) return null;
	const words: number[] = [];
	for (let i = 0; i < 16; i += 2) words.push((bytes[i] << 8) | bytes[i + 1]);
	if (words.slice(0, 5).every((w) => w === 0) && words[5] === 0xffff) {
		return `::ffff:${Array.from(bytes.slice(12)).join('.')}`;
	}
	let best = { start: -1, len: 0 };
	for (let i = 0; i < 8;) {
		if (words[i] !== 0) {
			i++;
			continue;
		}
		let j = i;
		while (j < 8 && words[j] === 0) j++;
		if (j - i > best.len) best = { start: i, len: j - i };
		i = j;
	}
	const hex = (ws: number[]) => ws.map((w) => w.toString(16)).join(':');
	if (best.len < 2) return hex(words);
	return `${hex(words.slice(0, best.start))}::${hex(words.slice(best.start + best.len))}`;
}

/** FormatConverter::ipToLong: IPv4 text to its integer, anything else unchanged. */
export function ipToLong(buffer: string): string {
	const v4 = parseV4(buffer);
	if (!v4) return buffer;
	return String(((v4[0] << 24) >>> 0) + (v4[1] << 16) + (v4[2] << 8) + v4[3]);
}

/** FormatConverter::longToIp: integers 0..4294967295 become dotted quads, anything else unchanged. */
export function longToIp(buffer: string): string {
	if (!/^\d+$/.test(buffer)) return buffer;
	const n = Number(buffer);
	if (n > 4294967295) return buffer;
	return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/** FormatConverter::ipToBinary: `0x<hex>` of the packed address, unchanged when not an IP. */
export function ipToBinary(buffer: string): string {
	const bin = inetPton(buffer);
	return bin ? `0x${toHex(bin)}` : buffer;
}

/** FormatConverter::binaryToIp. `0x<hex>` text is unpacked; other text is returned (hex of the bytes when binary). */
export function binaryToIp(buffer: string, isBinary: boolean, raw?: Uint8Array): string {
	if (!buffer.startsWith('0x')) {
		return isBinary ? (raw ? toHex(raw) : buffer) : buffer;
	}
	const hex = buffer.slice(2);
	if (hex.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(hex)) return buffer;
	const bytes = Uint8Array.from(hex.match(/../g) ?? [], (h) => Number.parseInt(h, 16));
	return inetNtop(bytes) ?? '';
}
