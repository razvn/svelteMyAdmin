import { N_ } from '#lib/i18n/translator.ts';

/** Login URL used when the stored credentials were rejected by the MySQL server. */
export function expiredLoginLocation(method: string, url: URL): string {
	const params = new URLSearchParams({ expired: '1' });
	if (
		(method === 'GET' || method === 'HEAD') &&
		url.pathname !== '/' &&
		url.pathname !== '/login'
	) {
		params.set('redirect', url.pathname + url.search);
	}
	return `/login?${params}`;
}

export const EXPIRED_MESSAGE = N_(
	'Your session has expired or your credentials are no longer valid. Please log in again.'
);
