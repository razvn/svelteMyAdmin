/** Session gating while the second factor of a login is pending. */

/** Reachable without being fully authenticated. */
export function isPublicPath(pathname: string): boolean {
	return (
		pathname === '/login' ||
		pathname.startsWith('/login/') ||
		pathname === '/logout' ||
		pathname === '/api/health' ||
		pathname === '/api/lang' ||
		pathname.startsWith('/_app/')
	);
}

/** Sessions from before 2FA existed have no flag and count as verified. */
export function isTwoFactorPending(session: { twoFactorVerified?: boolean } | null): boolean {
	return session?.twoFactorVerified === false;
}

/** Where a pending session must go for this request, or null when the request may proceed. */
export function twoFactorRedirect(
	pending: boolean,
	method: string,
	pathname: string,
	search: string
): string | null {
	if (!pending || isPublicPath(pathname)) return null;
	const safe = (method === 'GET' || method === 'HEAD') && pathname !== '/';
	return safe ? `/login/2fa?redirect=${encodeURIComponent(pathname + search)}` : '/login/2fa';
}
