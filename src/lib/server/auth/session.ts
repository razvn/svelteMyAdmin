import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { decrypt, deriveKey, encrypt } from './crypto';

export const SESSION_COOKIE = 'sma_session';

/** Decrypted content of the session cookie. */
export const sessionPayloadSchema = z.object({
	serverIndex: z.number().int().min(1),
	/** Only set when the user entered an arbitrary server. */
	host: z.string().optional(),
	port: z.number().int().min(0).max(65535).optional(),
	user: z.string(),
	password: z.string(),
	createdAt: z.number(),
	lastActivity: z.number(),
	/** false while the second factor is pending; absent (sessions from before 2FA) means verified. */
	twoFactorVerified: z.boolean().optional()
});
export type SessionPayload = z.infer<typeof sessionPayloadSchema>;

let generatedSecret: string | undefined;

/**
 * The secret used to derive the cookie key: `blowfish_secret`, or a random
 * per-process one (sessions are then lost on restart).
 */
export function getSecret(
	blowfishSecret: string,
	warn: (msg: string) => void = (m) => console.warn(m)
): string {
	if (blowfishSecret) return blowfishSecret;
	if (!generatedSecret) {
		generatedSecret = randomBytes(32).toString('hex');
		warn(
			'[svelteMyAdmin] blowfish_secret is empty: using a random secret, sessions will be lost on restart. ' +
				'Set blowfish_secret in config.json.'
		);
	}
	return generatedSecret;
}

/**
 * Sessions ended by a logout (per process). A slow in-flight request of the logged-out browser could
 * otherwise write its old cookie back; such a cookie is rejected here. Entries expire after the
 * cookie validity, when the cookie would be invalid anyway.
 */
const revoked = new Map<string, number>();

const revocationKey = (s: Pick<SessionPayload, 'serverIndex' | 'user' | 'createdAt'>): string =>
	`${s.serverIndex}\0${s.user}\0${s.createdAt}`;

export function revokeSession(
	s: Pick<SessionPayload, 'serverIndex' | 'user' | 'createdAt'>,
	validitySeconds: number,
	now: number = Date.now()
): void {
	for (const [k, until] of revoked) if (until <= now) revoked.delete(k);
	revoked.set(revocationKey(s), now + validitySeconds * 1000);
}

export function isRevoked(
	s: Pick<SessionPayload, 'serverIndex' | 'user' | 'createdAt'>,
	now: number = Date.now()
): boolean {
	const until = revoked.get(revocationKey(s));
	return until !== undefined && until > now;
}

export function sealSession(payload: SessionPayload, secret: string): string {
	return encrypt(JSON.stringify(payload), deriveKey(secret));
}

/**
 * Decrypt and validate a session cookie value. Returns null when tampered,
 * malformed or inactive for longer than `validitySeconds` (sliding expiry).
 */
export function openSession(
	token: string | undefined,
	secret: string,
	validitySeconds: number,
	now: number = Date.now()
): SessionPayload | null {
	if (!token) return null;
	const json = decrypt(token, deriveKey(secret));
	if (json === null) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(json);
	} catch {
		return null;
	}
	const result = sessionPayloadSchema.safeParse(parsed);
	if (!result.success) return null;
	const s = result.data;
	if (s.lastActivity > now + 60_000) return null; // from the future
	if (now - s.lastActivity > validitySeconds * 1000) return null;
	if (isRevoked(s, now)) return null;
	return s;
}
