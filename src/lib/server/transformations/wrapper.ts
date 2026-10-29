/**
 * Transformation wrapper (Controllers/Transformation/WrapperController): streams the bytes of one
 * cell with a safe Content-Type.
 */

/** Types the wrapper may serve inline; everything else is a download. */
const INLINE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp'];

/** Image type from the magic bytes, or null. */
export function sniffImage(bytes: Uint8Array): string | null {
	const at = (i: number) => bytes[i];
	if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
	if (bytes.length >= 8 && at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) {
		return 'image/png';
	}
	if (bytes.length >= 6 && String.fromCharCode(...bytes.subarray(0, 4)) === 'GIF8') {
		return 'image/gif';
	}
	if (
		bytes.length >= 12 &&
		String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
		String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP'
	) {
		return 'image/webp';
	}
	if (bytes.length >= 2 && at(0) === 0x42 && at(1) === 0x4d) return 'image/bmp';
	return null;
}

/** `image_jpeg` (stored media type) -> `image/jpeg`. */
export const mimeFromStored = (stored: string): string => stored.replace('_', '/');

/**
 * The Content-Type to answer with: the requested one when it is on the inline allowlist, then the
 * stored media type of the column, then the magic bytes; downloads otherwise.
 */
export function chooseContentType(
	bytes: Uint8Array,
	requested: string | null,
	stored: string | null
): { type: string; inline: boolean } {
	const candidates = [requested, stored ? mimeFromStored(stored) : null].map((c) =>
		c?.toLowerCase()
	);
	const sniffed = sniffImage(bytes);
	for (const c of candidates) {
		if (c && INLINE_TYPES.includes(c)) return { type: c, inline: true };
		if (c === 'application/octet-stream') return { type: c, inline: false };
	}
	return sniffed
		? { type: sniffed, inline: true }
		: { type: 'application/octet-stream', inline: false };
}

/** A file name safe for a Content-Disposition header. */
export const safeFileName = (name: string, fallback: string): string =>
	name.replace(/[^\w.-]+/g, '_').slice(0, 100) || fallback;
