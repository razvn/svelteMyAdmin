/**
 * Only same-origin relative redirect targets are accepted (open redirect protection).
 * Returns the sanitised `path?query#hash`, or `fallback`.
 */
export function safeRedirectTarget(target: unknown, fallback = '/'): string {
	if (typeof target !== 'string' || target === '') return fallback;
	// eslint-disable-next-line no-control-regex
	if (!target.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(target)) return fallback;
	if (target.startsWith('//')) return fallback;
	try {
		const base = 'http://sma.invalid';
		const url = new URL(target, base);
		if (url.origin !== base) return fallback;
		if (url.pathname === '/login' || url.pathname === '/logout') return fallback;
		return url.pathname + url.search + url.hash;
	} catch {
		return fallback;
	}
}
