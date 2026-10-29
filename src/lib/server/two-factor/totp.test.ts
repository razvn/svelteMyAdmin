import { describe, expect, it } from 'vitest';
import {
	base32Decode,
	base32Encode,
	generateSecret,
	hotp,
	otpauthUri,
	totp,
	verifyTotp
} from './totp.ts';

// RFC 6238 appendix B: 8 digit codes; the 6 digit code is the last six digits.
const SHA1 = base32Encode(Buffer.from('12345678901234567890'));
const SHA256 = base32Encode(Buffer.from('12345678901234567890123456789012'));
const SHA512 = base32Encode(
	Buffer.from('1234567890123456789012345678901234567890123456789012345678901234')
);
const VECTORS: [number, string, string, string][] = [
	[59, '94287082', '46119246', '90693936'],
	[1111111109, '07081804', '68084774', '25091201'],
	[1111111111, '14050471', '67062674', '99943326'],
	[1234567890, '89005924', '91819424', '93441116'],
	[2000000000, '69279037', '90698825', '38618901'],
	[20000000000, '65353130', '77737706', '47863826']
];

describe('base32', () => {
	it('matches the RFC 4648 vectors', () => {
		const cases: [string, string][] = [
			['', ''],
			['f', 'MY'],
			['fo', 'MZXQ'],
			['foo', 'MZXW6'],
			['foob', 'MZXW6YQ'],
			['fooba', 'MZXW6YTB'],
			['foobar', 'MZXW6YTBOI']
		];
		for (const [plain, enc] of cases) {
			expect(base32Encode(Buffer.from(plain))).toBe(enc);
			expect(base32Decode(enc)?.toString()).toBe(plain);
		}
	});
	it('decodes lower case, padding and spaces; rejects invalid characters', () => {
		expect(base32Decode('mzxw 6ytb oi======')?.toString()).toBe('foobar');
		expect(base32Decode('MZXW1')).toBeNull();
	});
	it('round-trips random bytes', () => {
		for (let n = 1; n < 40; n++) {
			const data = Buffer.from(Array.from({ length: n }, (_, i) => (i * 37 + n) & 255));
			expect(base32Decode(base32Encode(data))?.equals(data)).toBe(true);
		}
	});
});

describe('hotp (RFC 4226 appendix D)', () => {
	it('produces the published codes', () => {
		const key = Buffer.from('12345678901234567890');
		const expected = [
			'755224',
			'287082',
			'359152',
			'969429',
			'338314',
			'254676',
			'287922',
			'162583',
			'399871',
			'520489'
		];
		expected.forEach((code, i) => expect(hotp(key, i)).toBe(code));
	});
});

describe('totp (RFC 6238 appendix B)', () => {
	it('matches the SHA-1, SHA-256 and SHA-512 vectors', () => {
		for (const [t, s1, s256, s512] of VECTORS) {
			expect(totp(SHA1, t * 1000, { digits: 8 })).toBe(s1);
			expect(totp(SHA256, t * 1000, { digits: 8, algorithm: 'sha256' })).toBe(s256);
			expect(totp(SHA512, t * 1000, { digits: 8, algorithm: 'sha512' })).toBe(s512);
		}
	});
	it('generates 6 digit codes by default', () => {
		expect(totp(SHA1, 59_000)).toBe('287082');
	});
});

describe('verifyTotp time windows', () => {
	const now = 1234567890_000;
	const code = totp(SHA1, now);
	it('accepts the current code and spaces inside it', () => {
		expect(verifyTotp(SHA1, code, { timeMs: now })).toBe(true);
		expect(verifyTotp(SHA1, `${code.slice(0, 3)} ${code.slice(3)}`, { timeMs: now })).toBe(true);
	});
	it('accepts the neighbouring steps and rejects further ones', () => {
		expect(verifyTotp(SHA1, code, { timeMs: now + 30_000 })).toBe(true);
		expect(verifyTotp(SHA1, code, { timeMs: now - 30_000 })).toBe(true);
		expect(verifyTotp(SHA1, code, { timeMs: now + 90_000 })).toBe(false);
		expect(verifyTotp(SHA1, code, { timeMs: now + 90_000, window: 3 })).toBe(true);
		expect(verifyTotp(SHA1, code, { timeMs: now + 30_000, window: 0 })).toBe(false);
	});
	it('rejects malformed codes and secrets', () => {
		expect(verifyTotp(SHA1, '12345', { timeMs: now })).toBe(false);
		expect(verifyTotp(SHA1, 'abcdef', { timeMs: now })).toBe(false);
		expect(verifyTotp(SHA1, '', { timeMs: now })).toBe(false);
		expect(verifyTotp('!!!', code, { timeMs: now })).toBe(false);
		expect(verifyTotp('', code, { timeMs: now })).toBe(false);
	});
});

describe('secrets and URIs', () => {
	it('generates unique 32 character base32 secrets', () => {
		const a = generateSecret();
		expect(a).toMatch(/^[A-Z2-7]{32}$/);
		expect(generateSecret()).not.toBe(a);
	});
	it('builds the otpauth key URI', () => {
		expect(otpauthUri('ABC', 'svelteMyAdmin (db.example)', 'a b')).toBe(
			'otpauth://totp/svelteMyAdmin%20(db.example):a%20b?secret=ABC&issuer=svelteMyAdmin%20(db.example)'
		);
	});
});
