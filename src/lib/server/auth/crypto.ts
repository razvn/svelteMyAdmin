import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const INFO = 'svelteMyAdmin session v1';

/** Derive the 256-bit AES key from the configured secret (HKDF-SHA256). */
export function deriveKey(secret: string): Buffer {
	return Buffer.from(hkdfSync('sha256', secret, 'sma-salt', INFO, 32));
}

/** AES-256-GCM encrypt. Output: base64url(iv | tag | ciphertext). */
export function encrypt(plaintext: string, key: Buffer): string {
	const iv = randomBytes(IV_LENGTH);
	const cipher = createCipheriv('aes-256-gcm', key, iv);
	const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), data]).toString('base64url');
}

/** Decrypt the output of `encrypt`. Returns null when malformed or tampered with. */
export function decrypt(token: string, key: Buffer): string | null {
	try {
		const raw = Buffer.from(token, 'base64url');
		if (raw.length < IV_LENGTH + TAG_LENGTH) return null;
		const iv = raw.subarray(0, IV_LENGTH);
		const tag = raw.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
		const data = raw.subarray(IV_LENGTH + TAG_LENGTH);
		const decipher = createDecipheriv('aes-256-gcm', key, iv);
		decipher.setAuthTag(tag);
		return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
	} catch {
		return null;
	}
}
