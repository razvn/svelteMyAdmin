/**
 * HOTP (RFC 4226) / TOTP (RFC 6238) and RFC 4648 base32, on node:crypto only. The secret format is the
 * one of Google Authenticator / pragmarx/google2fa (unpadded upper-case base32), so secrets stored by
 * phpMyAdmin keep working.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(data: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let out = '';
	for (const byte of data) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			out += ALPHABET[(value >>> (bits - 5)) & 31];
			bits -= 5;
		}
		value &= (1 << bits) - 1;
	}
	if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
	return out;
}

/** Decode base32 (case-insensitive, padding and spaces ignored). Returns null on invalid characters. */
export function base32Decode(text: string): Buffer | null {
	const clean = text.replace(/[\s=-]/g, '').toUpperCase();
	let bits = 0;
	let value = 0;
	const out: number[] = [];
	for (const ch of clean) {
		const idx = ALPHABET.indexOf(ch);
		if (idx < 0) return null;
		value = (value << 5) | idx;
		bits += 5;
		if (bits >= 8) {
			out.push((value >>> (bits - 8)) & 255);
			bits -= 8;
			value &= (1 << bits) - 1;
		}
	}
	return Buffer.from(out);
}

/** A new random secret: 160 bits, as 32 base32 characters. */
export function generateSecret(bytes = 20): string {
	return base32Encode(randomBytes(bytes));
}

export type TotpAlgorithm = 'sha1' | 'sha256' | 'sha512';

export function hotp(
	key: Uint8Array,
	counter: number,
	digits = 6,
	algorithm: TotpAlgorithm = 'sha1'
): string {
	const buf = Buffer.alloc(8);
	buf.writeBigUInt64BE(BigInt(counter));
	const h = createHmac(algorithm, key).update(buf).digest();
	const offset = h[h.length - 1] & 0x0f;
	const bin =
		((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
	return String(bin % 10 ** digits).padStart(digits, '0');
}

export interface TotpOptions {
	digits?: number;
	/** Time step in seconds. */
	period?: number;
	algorithm?: TotpAlgorithm;
}

/** The code valid at `timeMs` (Unix milliseconds). */
export function totp(secret: string, timeMs: number = Date.now(), opts: TotpOptions = {}): string {
	const key = base32Decode(secret);
	if (!key || key.length === 0) throw new Error('Invalid TOTP secret');
	const period = opts.period ?? 30;
	return hotp(key, Math.floor(timeMs / 1000 / period), opts.digits ?? 6, opts.algorithm);
}

function safeEqual(a: string, b: string): boolean {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Check a user supplied code against the codes of the current time step and `window` steps before and
 * after it (clock drift). phpMyAdmin uses a window of 8 (4 minutes); the default here is 1 (+-30 s).
 * Returns false for a malformed secret or code.
 */
export function verifyTotp(
	secret: string,
	code: string,
	opts: TotpOptions & { window?: number; timeMs?: number } = {}
): boolean {
	const digits = opts.digits ?? 6;
	const normalized = code.replace(/\s/g, '');
	if (!/^\d+$/.test(normalized) || normalized.length !== digits) return false;
	const key = base32Decode(secret);
	if (!key || key.length === 0) return false;
	const period = opts.period ?? 30;
	const step = Math.floor((opts.timeMs ?? Date.now()) / 1000 / period);
	const window = opts.window ?? 1;
	let ok = false;
	for (let i = -window; i <= window; i++) {
		if (step + i < 0) continue;
		// no early exit: constant work for every candidate
		if (safeEqual(hotp(key, step + i, digits, opts.algorithm), normalized)) ok = true;
	}
	return ok;
}

/** `otpauth://totp/Issuer:account?secret=...&issuer=Issuer` (Key URI format of Google Authenticator). */
export function otpauthUri(secret: string, issuer: string, account: string): string {
	const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
	return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
}
