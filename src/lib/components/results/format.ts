/** Cell value formatting for the result grid (pure, client-safe). */
import { formatByteDown } from '#lib/format.ts';

/** Binary (BLOB/BINARY) cell: only its size and a short hex preview travel to the browser. */
export interface BinaryCell {
	bytes: number;
	/** Hex of the first bytes. */
	preview: string;
}
/** `null` = SQL NULL; everything else is already text. */
export type Cell = string | null | BinaryCell;

export const isBinaryCell = (c: Cell): c is BinaryCell => typeof c === 'object' && c !== null;

/** `[BLOB - 12 B]`, `[BLOB - 1.5 KiB]`. */
export function formatBinary(cell: BinaryCell): string {
	if (cell.bytes < 1024) return `[BLOB - ${cell.bytes} B]`;
	const [v, unit] = formatByteDown(cell.bytes, 3, 1) ?? [String(cell.bytes), 'B'];
	return `[BLOB - ${v} ${unit}]`;
}

/** Hex preview with `0x` and an ellipsis when the value is longer than the preview. */
export function binaryTitle(cell: BinaryCell): string {
	return `0x${cell.preview.toUpperCase()}${cell.preview.length / 2 < cell.bytes ? '…' : ''}`;
}

export interface Truncated {
	text: string;
	truncated: boolean;
}

/** Cut `text` to `limit` characters (0 or less = never truncate). Counts code points, not UTF-16 units. */
export function truncate(text: string, limit: number): Truncated {
	if (limit <= 0 || text.length <= limit) return { text, truncated: false };
	const chars = Array.from(text);
	if (chars.length <= limit) return { text, truncated: false };
	return { text: chars.slice(0, limit).join(''), truncated: true };
}

/** Pretty printed JSON, or null when `text` is not valid JSON. */
export function prettyJson(text: string): string | null {
	try {
		return JSON.stringify(JSON.parse(text), null, 2);
	} catch {
		return null;
	}
}

/** Plain text of a cell (for copying / titles). */
export function cellText(cell: Cell): string {
	if (cell === null) return 'NULL';
	if (isBinaryCell(cell)) return formatBinary(cell);
	return cell;
}
