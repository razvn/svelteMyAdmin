import { isIP } from 'node:net';

/**
 * Real client address, like Core::getIp(): the direct peer address, unless it is
 * listed in `TrustedProxies` (proxy IP => header name), in which case the first
 * address of that header is used. Returns null when it cannot be determined.
 */
export function resolveClientIp(
	directAddress: string | null | undefined,
	headers: Pick<Headers, 'get'>,
	trustedProxies: Record<string, string>
): string | null {
	if (!directAddress) return null;
	const direct = directAddress.replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
	const header = Object.hasOwn(trustedProxies, directAddress)
		? trustedProxies[directAddress]
		: Object.hasOwn(trustedProxies, direct)
			? trustedProxies[direct]
			: undefined;
	if (header === undefined) return direct;
	const value = (headers.get(header) ?? '').split(',')[0].trim();
	return isIP(value) ? value : null;
}
