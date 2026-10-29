/**
 * Short-lived sealed cookies holding the server side half of a two-factor step (phpMyAdmin keeps these in
 * `$_SESSION`: `2fa_application_key`, `WebAuthnCredential{Request,Creation}Options`). AES-GCM sealed with a
 * key derived from `blowfish_secret` + purpose, bound to the user and an expiry.
 */
import type { Cookies } from '@sveltejs/kit';
import { z } from 'zod';
import { decrypt, deriveKey, encrypt } from '#lib/server/auth/crypto.ts';
import { getSecret } from '#lib/server/auth/session.ts';

export type StateKind = 'login' | 'setup' | 'confirm';
const COOKIE = (kind: StateKind) => `sma_2fa_${kind}`;
const TTL_MS = 10 * 60_000;

const stateSchema = z.object({
	kind: z.string(),
	user: z.string(),
	serverIndex: z.number(),
	exp: z.number(),
	data: z.record(z.string(), z.unknown())
});

const key = (secret: string, kind: StateKind) => deriveKey(`${getSecret(secret)}|2fa|${kind}`);

export function sealState(
	secret: string,
	kind: StateKind,
	user: string,
	serverIndex: number,
	data: Record<string, unknown>,
	now = Date.now()
): string {
	return encrypt(
		JSON.stringify({ kind, user, serverIndex, exp: now + TTL_MS, data }),
		key(secret, kind)
	);
}

export function openState(
	secret: string,
	kind: StateKind,
	token: string | undefined,
	user: string,
	serverIndex: number,
	now = Date.now()
): Record<string, unknown> | null {
	if (!token) return null;
	const json = decrypt(token, key(secret, kind));
	if (json === null) return null;
	try {
		const r = stateSchema.safeParse(JSON.parse(json));
		if (!r.success) return null;
		const s = r.data;
		if (s.kind !== kind || s.user !== user || s.serverIndex !== serverIndex || s.exp < now) {
			return null;
		}
		return s.data;
	} catch {
		return null;
	}
}

export function setState(
	cookies: Cookies,
	secret: string,
	kind: StateKind,
	user: string,
	serverIndex: number,
	data: Record<string, unknown>,
	secure: boolean
): void {
	cookies.set(COOKIE(kind), sealState(secret, kind, user, serverIndex, data), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure,
		maxAge: TTL_MS / 1000
	});
}

export function getState(
	cookies: Cookies,
	secret: string,
	kind: StateKind,
	user: string,
	serverIndex: number
): Record<string, unknown> | null {
	return openState(secret, kind, cookies.get(COOKIE(kind)), user, serverIndex);
}

export function clearState(cookies: Cookies, kind: StateKind): void {
	cookies.delete(COOKIE(kind), { path: '/' });
}
