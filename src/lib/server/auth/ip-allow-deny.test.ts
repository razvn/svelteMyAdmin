import { describe, expect, it } from 'vitest';
import {
	ipMaskTest,
	ipv4MaskTest,
	ipv6MaskTest,
	isForbidden,
	matchRules,
	normalizeIp
} from './ip-allow-deny';

describe('ipv4MaskTest', () => {
	it('matches exact addresses', () => {
		expect(ipv4MaskTest('192.168.1.10', '192.168.1.10')).toBe(true);
		expect(ipv4MaskTest('192.168.1.10', '192.168.1.11')).toBe(false);
	});
	it('matches CIDR', () => {
		expect(ipv4MaskTest('10.0.0.0/8', '10.255.1.2')).toBe(true);
		expect(ipv4MaskTest('10.0.0.0/8', '11.0.0.1')).toBe(false);
		expect(ipv4MaskTest('192.168.1.0/24', '192.168.1.200')).toBe(true);
		expect(ipv4MaskTest('192.168.1.0/24', '192.168.2.1')).toBe(false);
		expect(ipv4MaskTest('192.168.1.5/32', '192.168.1.5')).toBe(true);
		expect(ipv4MaskTest('192.168.1.5/32', '192.168.1.6')).toBe(false);
		expect(ipv4MaskTest('0.0.0.0/0', '8.8.8.8')).toBe(true);
		expect(ipv4MaskTest('128.0.0.0/1', '200.0.0.1')).toBe(true);
		expect(ipv4MaskTest('128.0.0.0/1', '100.0.0.1')).toBe(false);
	});
	it('matches octet ranges', () => {
		expect(ipv4MaskTest('192.168.1.[10-20]', '192.168.1.15')).toBe(true);
		expect(ipv4MaskTest('192.168.1.[10-20]', '192.168.1.21')).toBe(false);
		expect(ipv4MaskTest('192.168.[0-3].1', '192.168.2.1')).toBe(true);
		expect(ipv4MaskTest('192.168.[0-3].1', '192.168.4.1')).toBe(false);
	});
	it('rejects garbage', () => {
		expect(ipv4MaskTest('10.0.0.0/8', 'not-an-ip')).toBe(false);
		expect(ipv4MaskTest('10.0.0/8', '10.0.0.1')).toBe(false);
		expect(ipv4MaskTest('10.0.0.0/33', '10.0.0.1')).toBe(false);
	});
});

describe('ipv6MaskTest', () => {
	it('matches exact addresses regardless of notation and case', () => {
		expect(ipv6MaskTest('2001:db8::1', '2001:0DB8:0:0:0:0:0:1')).toBe(true);
		expect(ipv6MaskTest('::1', '::1')).toBe(true);
		expect(ipv6MaskTest('2001:db8::1', '2001:db8::2')).toBe(false);
	});
	it('matches CIDR', () => {
		expect(ipv6MaskTest('2001:db8::/32', '2001:db8:ffff::1')).toBe(true);
		expect(ipv6MaskTest('2001:db8::/32', '2001:db9::1')).toBe(false);
		expect(ipv6MaskTest('fe80::/10', 'febf::1')).toBe(true);
		expect(ipv6MaskTest('fe80::/10', 'fec0::1')).toBe(false);
		expect(ipv6MaskTest('::/0', '2001::1')).toBe(true);
		expect(ipv6MaskTest('2001:db8::1/128', '2001:db8::1')).toBe(true);
	});
	it('matches last-group ranges', () => {
		expect(ipv6MaskTest('2001:db8::[10-20]', '2001:db8::15')).toBe(true);
		expect(ipv6MaskTest('2001:db8::[10-20]', '2001:db8::21')).toBe(false);
	});
	it('rejects invalid input', () => {
		expect(ipv6MaskTest('2001:db8::/32', 'nope')).toBe(false);
		expect(ipv6MaskTest('2001:db8::/200', '2001:db8::1')).toBe(false);
	});
});

describe('ipMaskTest', () => {
	it('dispatches on address family', () => {
		expect(ipMaskTest('10.0.0.0/8', '10.1.1.1')).toBe(true);
		expect(ipMaskTest('10.0.0.0/8', '::1')).toBe(false);
		expect(ipMaskTest('::1', '10.0.0.1')).toBe(false);
	});
	it('treats IPv4-mapped IPv6 as IPv4', () => {
		expect(normalizeIp('::ffff:127.0.0.1')).toBe('127.0.0.1');
		expect(normalizeIp('::ffff:7f00:1')).toBe('127.0.0.1');
		expect(ipMaskTest('127.0.0.1/8', '::ffff:127.0.0.1')).toBe(true);
	});
});

describe('matchRules', () => {
	const ctx = (clientIp: string | null, username = 'bob') => ({ clientIp, username });
	it('handles `all`, `localhost` and the optional "from"', () => {
		expect(matchRules('allow', ['allow % from all'], ctx('8.8.8.8'))).toBe(true);
		expect(matchRules('allow', ['allow % all'], ctx('2001:db8::1'))).toBe(true);
		expect(matchRules('allow', ['allow bob from localhost'], ctx('127.0.0.1'))).toBe(true);
		expect(matchRules('allow', ['allow bob from localhost'], ctx('::1'))).toBe(true);
		expect(matchRules('allow', ['allow bob from localhost'], ctx('10.0.0.1'))).toBe(false);
	});
	it('filters by user and type', () => {
		expect(matchRules('allow', ['allow alice from all'], ctx('1.1.1.1'))).toBe(false);
		expect(matchRules('deny', ['allow bob from all'], ctx('1.1.1.1'))).toBe(false);
		expect(matchRules('deny', ['deny % from 1.1.1.1'], ctx('1.1.1.1', 'anyone'))).toBe(true);
	});
	it('supports localnet shortcuts only with a server address', () => {
		const rules = ['allow % from localnetC'];
		expect(matchRules('allow', rules, ctx('192.168.1.7'))).toBe(false);
		expect(matchRules('allow', rules, { ...ctx('192.168.1.7'), serverAddr: '192.168.1.1' })).toBe(
			true
		);
	});
	it('never matches without a client address', () => {
		expect(matchRules('allow', ['allow % from all'], ctx(null))).toBe(false);
		expect(matchRules('allow', ['allow % from all'], ctx(''))).toBe(false);
	});
	it('ignores malformed rules', () => {
		expect(matchRules('allow', ['', 'allow', 'allow bob'], ctx('1.1.1.1'))).toBe(false);
	});
});

describe('isForbidden', () => {
	const rules = ['allow bob from 10.0.0.0/8', 'deny % from 10.9.0.0/16'];
	const f = (order: string, ip: string, user = 'bob', r = rules) =>
		isForbidden({ order, rules: r }, { clientIp: ip, username: user });

	it('has no effect without an order', () => {
		expect(f('', '1.2.3.4')).toBe(false);
	});
	it('allow,deny: forbidden by default, deny wins', () => {
		expect(f('allow,deny', '10.1.1.1')).toBe(false);
		expect(f('allow,deny', '11.1.1.1')).toBe(true);
		expect(f('allow,deny', '10.9.1.1')).toBe(true);
	});
	it('deny,allow: allowed by default, allow wins', () => {
		expect(f('deny,allow', '11.1.1.1')).toBe(false);
		expect(f('deny,allow', '10.9.1.1')).toBe(false); // allow overrides
		expect(f('deny,allow', '12.0.0.1', 'bob', ['deny % from all'])).toBe(true);
		expect(
			f('deny,allow', '10.1.1.1', 'bob', ['deny % from all', 'allow bob from 10.0.0.0/8'])
		).toBe(false);
	});
	it('explicit: needs allow and no deny', () => {
		expect(f('explicit', '10.1.1.1')).toBe(false);
		expect(f('explicit', '10.9.1.1')).toBe(true);
		expect(f('explicit', '11.1.1.1')).toBe(true);
		expect(f('explicit', '10.1.1.1', 'alice')).toBe(true);
	});
	it('forbids when the client address is unknown (except deny,allow)', () => {
		expect(isForbidden({ order: 'explicit', rules }, { clientIp: null, username: 'bob' })).toBe(
			true
		);
		expect(isForbidden({ order: 'allow,deny', rules }, { clientIp: null, username: 'bob' })).toBe(
			true
		);
		expect(isForbidden({ order: 'deny,allow', rules }, { clientIp: null, username: 'bob' })).toBe(
			false
		);
	});
});
