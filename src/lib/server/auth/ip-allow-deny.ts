/**
 * Port of phpMyAdmin's IpAllowDeny + AuthenticationPlugin::checkRules (allow/deny part).
 *
 * Deviation: IPv4 CIDR masks are computed correctly (phpMyAdmin ignores the top bit
 * of the mask), IPv4-mapped IPv6 addresses (::ffff:a.b.c.d) are treated as IPv4 and
 * the `all` shortcut matches IPv6 clients too.
 */
import { isIPv4, isIPv6 } from 'node:net';

export type AllowDenyOrder = '' | 'deny,allow' | 'allow,deny' | 'explicit';

/** IPv4 dotted quad to 32-bit unsigned integer, null if invalid. */
function ipv4ToInt(ip: string): number | null {
	if (!isIPv4(ip)) return null;
	return ip.split('.').reduce((acc, o) => acc * 256 + Number(o), 0);
}

/** Expand any IPv6 address into 32 lowercase hex digits, null if invalid. */
function ipv6ToHex(ip: string): string | null {
	let addr = ip.toLowerCase();
	const zone = addr.indexOf('%');
	if (zone >= 0) addr = addr.slice(0, zone);
	if (!isIPv6(addr)) return null;
	// Embedded IPv4 tail (::ffff:1.2.3.4)
	const tail = addr.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
	if (tail) {
		const n = ipv4ToInt(tail[2]);
		if (n === null) return null;
		addr = tail[1] + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16);
	}
	const [head, rest] = addr.split('::');
	const headParts = head ? head.split(':') : [];
	const restParts = rest === undefined ? null : rest ? rest.split(':') : [];
	let groups: string[];
	if (restParts === null) {
		groups = headParts;
	} else {
		const fill = 8 - headParts.length - restParts.length;
		groups = [...headParts, ...Array<string>(Math.max(fill, 0)).fill('0'), ...restParts];
	}
	if (groups.length !== 8) return null;
	return groups.map((g) => g.padStart(4, '0')).join('');
}

/** Convert an IPv4-mapped IPv6 address to plain IPv4, else return as is. */
export function normalizeIp(ip: string): string {
	const m = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
	if (m) return m[1];
	const hex = ip.toLowerCase().startsWith('::ffff:') ? ipv6ToHex(ip) : null;
	if (hex && hex.startsWith('00000000000000000000ffff')) {
		const n = parseInt(hex.slice(24), 16);
		return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
	}
	return ip;
}

/**
 * Matches:
 * a.b.c.d (exact), a.b.c.[y-z] (range, any octet), a.b.c.d/nn (CIDR).
 */
export function ipv4MaskTest(testRange: string, ipToTest: string): boolean {
	const ip = ipv4ToInt(ipToTest);
	if (ip === null) return false;
	const cidr = testRange.match(/^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/);
	if (cidr) {
		const base = ipv4ToInt(cidr[1]);
		const bits = Number(cidr[2]);
		if (base === null || bits > 32) return false;
		if (bits === 0) return true;
		const mask = (0xffffffff << (32 - bits)) >>> 0;
		return (base & mask) >>> 0 === (ip & mask) >>> 0;
	}
	const maskOcts = testRange.split('.');
	const ipOcts = ipToTest.split('.');
	if (maskOcts.length !== 4) return false;
	for (let i = 0; i < 4; i++) {
		const range = maskOcts[i].match(/^\[(\d+)-(\d+)\]$/);
		const value = Number(ipOcts[i]);
		if (range) {
			if (value < Number(range[1]) || value > Number(range[2])) return false;
		} else if (!/^\d+$/.test(maskOcts[i]) || Number(maskOcts[i]) !== value) {
			return false;
		}
	}
	return true;
}

/**
 * Matches:
 * full address (exact), `...:[yyyy-zzzz]` (range of the last group), `address/nn` (CIDR).
 */
export function ipv6MaskTest(testRange: string, ipToTest: string): boolean {
	const range = testRange.toLowerCase();
	const ipHex = ipv6ToHex(ipToTest);
	if (ipHex === null) return false;

	if (range.includes('/')) {
		const [addr, prefix] = range.split('/');
		const first = ipv6ToHex(addr);
		const bits = Number(prefix);
		if (first === null || !Number.isInteger(bits) || bits < 0 || bits > 128) return false;
		const a = BigInt('0x' + first);
		const b = BigInt('0x' + ipHex);
		const shift = BigInt(128 - bits);
		return a >> shift === b >> shift;
	}
	if (range.includes('[')) {
		const m = range.match(/\[([0-9a-f]+)-([0-9a-f]+)\]/);
		if (!m) return false;
		const firstHex = ipv6ToHex(range.replace(m[0], m[1]));
		const lastHex = ipv6ToHex(range.replace(m[0], m[2]));
		if (firstHex === null || lastHex === null) return false;
		return ipHex >= firstHex && ipHex <= lastHex;
	}
	return ipv6ToHex(range) === ipHex;
}

/** Match one IP against one range expression (IPv4 or IPv6). */
export function ipMaskTest(testRange: string, ipToTest: string): boolean {
	const ip = normalizeIp(ipToTest);
	if (testRange.includes(':') || ip.includes(':')) {
		if (!ip.includes(':') || !testRange.includes(':')) return false;
		return ipv6MaskTest(testRange, ip);
	}
	return ipv4MaskTest(testRange, ip);
}

export interface RuleContext {
	/** Client address; empty/null never matches. */
	clientIp: string | null | undefined;
	/** MySQL user name the rules are evaluated for. */
	username: string;
	/** Address of the server (for the `localnetA/B/C` shortcuts), optional. */
	serverAddr?: string;
}

/** Does any rule of `type` match this user and client address? */
export function matchRules(type: 'allow' | 'deny', rules: string[], ctx: RuleContext): boolean {
	if (!ctx.clientIp) return false;
	const shortcuts: Record<string, string> = {
		all: '0.0.0.0/0',
		localhost: '127.0.0.1/8'
	};
	if (ctx.serverAddr) {
		shortcuts.localnetA = ctx.serverAddr + '/8';
		shortcuts.localnetB = ctx.serverAddr + '/16';
		shortcuts.localnetC = ctx.serverAddr + '/24';
	}
	const ip = normalizeIp(ctx.clientIp);
	for (const rule of rules) {
		const data = rule.trim().split(/\s+/);
		if (data[0] !== type) continue;
		if (data[1] !== '%' && data[1] !== ctx.username) continue;
		let target = data[2];
		if (target === 'from') target = data[3];
		if (target === undefined) continue;
		if (target === 'all') return true;
		if (target === 'localhost') {
			// loopback in both families
			if (ip === '::1' || ipv4MaskTest('127.0.0.1/8', ip)) return true;
			continue;
		}
		target = shortcuts[target] ?? target;
		if (ipMaskTest(target, ip)) return true;
	}
	return false;
}

/**
 * Evaluate `AllowDeny` for a user. Returns true when access is FORBIDDEN.
 * Same decision table as AuthenticationPlugin::checkRules.
 */
export function isForbidden(
	allowDeny: { order: AllowDenyOrder | string; rules: string[] },
	ctx: RuleContext
): boolean {
	const allow = () => matchRules('allow', allowDeny.rules, ctx);
	const deny = () => matchRules('deny', allowDeny.rules, ctx);
	switch (allowDeny.order) {
		case 'allow,deny': {
			let forbidden = true;
			if (allow()) forbidden = false;
			if (deny()) forbidden = true;
			return forbidden;
		}
		case 'deny,allow': {
			let forbidden = false;
			if (deny()) forbidden = true;
			if (allow()) forbidden = false;
			return forbidden;
		}
		case 'explicit':
			return !(allow() && !deny());
		default:
			return false;
	}
}
