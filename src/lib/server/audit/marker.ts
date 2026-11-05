/**
 * Session detection for the audit log: a sealed browser cookie holding who was last seen, on which
 * server and when. A request starts a new session when the marker is missing, unreadable, older
 * than the idle limit, or belongs to another person or server. Works for every auth type.
 */
import type { Cookies } from '@sveltejs/kit';
import { z } from 'zod';
import { decrypt, deriveKey, encrypt } from '#lib/server/auth/crypto.ts';

export const AUDIT_COOKIE = 'sma_audit';
const INFO = 'svelteMyAdmin audit marker v2';

const markerSchema = z.object({
	user: z.string(),
	server: z.string(),
	seen: z.number()
});
type Marker = z.infer<typeof markerSchema>;

function openMarker(token: string | undefined, key: Buffer): Marker | null {
	if (!token) return null;
	const json = decrypt(token, key);
	if (json === null) return null;
	try {
		const parsed = markerSchema.safeParse(JSON.parse(json));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

export interface MarkActivity {
	secret: string;
	secure: boolean;
	idleMinutes: number;
	who: { user: string; server: string };
	now?: number;
}

/** Slide the marker forward; true when this request starts a new session. */
export function markActivity(cookies: Pick<Cookies, 'get' | 'set'>, o: MarkActivity): boolean {
	const now = o.now ?? Date.now();
	const key = deriveKey(o.secret, INFO);
	const prev = openMarker(cookies.get(AUDIT_COOKIE), key);
	const fresh =
		prev === null ||
		prev.user !== o.who.user ||
		prev.server !== o.who.server ||
		now - prev.seen >= o.idleMinutes * 60_000;
	const next: Marker = { user: o.who.user, server: o.who.server, seen: now };
	cookies.set(AUDIT_COOKIE, encrypt(JSON.stringify(next), key), {
		path: '/',
		httpOnly: true,
		sameSite: 'lax',
		secure: o.secure
	});
	return fresh;
}

/** After a logout the next request is a new session. */
export function clearMarker(cookies: Pick<Cookies, 'delete'>, secure: boolean): void {
	cookies.delete(AUDIT_COOKIE, { path: '/', httpOnly: true, sameSite: 'lax', secure });
}
