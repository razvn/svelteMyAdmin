import { describe, expect, it } from 'vitest';
import { decrypt, deriveKey, encrypt } from './crypto';
import { getSecret, openSession, sealSession, type SessionPayload } from './session';

const SECRET = 'a-test-secret-with-enough-entropy';
const now = 1_700_000_000_000;
const payload: SessionPayload = {
	serverIndex: 1,
	user: 'root',
	password: 'pä$$wörd"\n',
	createdAt: now,
	lastActivity: now
};

describe('crypto', () => {
	const key = deriveKey(SECRET);
	it('round-trips', () => {
		const token = encrypt('hello ✓', key);
		expect(decrypt(token, key)).toBe('hello ✓');
	});
	it('uses a fresh IV each time', () => {
		expect(encrypt('x', key)).not.toBe(encrypt('x', key));
	});
	it('rejects a wrong key', () => {
		expect(decrypt(encrypt('x', key), deriveKey('other'))).toBeNull();
	});
	it('detects tampering in every region', () => {
		const raw = Buffer.from(encrypt('secret data', key), 'base64url');
		for (const i of [0, 12, 20, raw.length - 1]) {
			const copy = Buffer.from(raw);
			copy[i] ^= 1;
			expect(decrypt(copy.toString('base64url'), key)).toBeNull();
		}
	});
	it('rejects garbage and truncated tokens', () => {
		expect(decrypt('', key)).toBeNull();
		expect(decrypt('abc', key)).toBeNull();
		expect(decrypt('!!!not base64!!!', key)).toBeNull();
	});
	it('does not leak the plaintext in the token', () => {
		const token = encrypt('supersecretpassword', key);
		expect(Buffer.from(token, 'base64url').toString('utf8')).not.toContain('supersecret');
	});
});

describe('session', () => {
	it('round-trips a session', () => {
		const token = sealSession(payload, SECRET);
		expect(openSession(token, SECRET, 1440, now + 1000)).toEqual(payload);
	});
	it('expires after LoginCookieValidity seconds of inactivity', () => {
		const token = sealSession(payload, SECRET);
		expect(openSession(token, SECRET, 60, now + 59_000)).not.toBeNull();
		expect(openSession(token, SECRET, 60, now + 61_000)).toBeNull();
	});
	it('rejects tampered or foreign tokens', () => {
		const token = sealSession(payload, SECRET);
		expect(openSession(token, 'different-secret', 1440, now)).toBeNull();
		expect(openSession(token.slice(0, -2) + 'AA', SECRET, 1440, now)).toBeNull();
		expect(openSession(undefined, SECRET, 1440, now)).toBeNull();
		expect(openSession('garbage', SECRET, 1440, now)).toBeNull();
	});
	it('rejects well-encrypted but invalid payloads', () => {
		const token = encrypt(JSON.stringify({ serverIndex: 'x' }), deriveKey(SECRET));
		expect(openSession(token, SECRET, 1440, now)).toBeNull();
		expect(openSession(encrypt('not json', deriveKey(SECRET)), SECRET, 1440, now)).toBeNull();
	});
	it('rejects sessions from the future', () => {
		const token = sealSession({ ...payload, lastActivity: now + 3_600_000 }, SECRET);
		expect(openSession(token, SECRET, 1440, now)).toBeNull();
	});
});

describe('getSecret', () => {
	it('prefers the configured secret', () => {
		expect(getSecret('configured', () => {})).toBe('configured');
	});
	it('generates a stable random secret and warns once', () => {
		const warnings: string[] = [];
		const a = getSecret('', (m) => warnings.push(m));
		const b = getSecret('', (m) => warnings.push(m));
		expect(a).toBe(b);
		expect(a).toHaveLength(64);
		expect(warnings).toHaveLength(1);
	});
});
