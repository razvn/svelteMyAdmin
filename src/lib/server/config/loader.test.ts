import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigError, getConfigPath, loadConfig, parseConfig } from './loader';

describe('parseConfig', () => {
	it('applies phpMyAdmin defaults', () => {
		const c = parseConfig({});
		expect(c.MaxRows).toBe(25);
		expect(c.LoginCookieValidity).toBe(1440);
		expect(c.DefaultLang).toBe('en');
		expect(c.ThemeDefault).toBe('pmahomme');
		expect(c.NavigationTreeEnableGrouping).toBe(true);
		expect(c.ShowStats).toBe(true);
		expect(c.blowfish_secret).toBe('');
		expect(c.ServerDefault).toBe(1);
	});

	it('adds a default server when none is configured', () => {
		const [s] = parseConfig({}).Servers;
		expect(s.host).toBe('localhost');
		expect(s.auth_type).toBe('cookie');
		expect(s.user).toBe('root');
		expect(s.AllowRoot).toBe(true);
		expect(s.AllowNoPassword).toBe(false);
		expect(s.ssl_verify).toBe(true);
		expect(s.pmadb).toBe('');
		expect(s.AllowDeny).toEqual({ order: '', rules: [] });
	});

	it('merges user values over defaults', () => {
		const c = parseConfig({
			MaxRows: 50,
			Servers: [{ host: 'db1', port: 3307, auth_type: 'config', user: 'u', password: 'p' }, {}]
		});
		expect(c.MaxRows).toBe(50);
		expect(c.Servers).toHaveLength(2);
		expect(c.Servers[0]).toMatchObject({ host: 'db1', port: 3307, auth_type: 'config' });
		expect(c.Servers[1].host).toBe('localhost');
	});

	it('normalises string ports like PHP', () => {
		const c = parseConfig({ Servers: [{ port: '3307' }, { port: '' }] });
		expect(c.Servers[0].port).toBe(3307);
		expect(c.Servers[1].port).toBe(0);
	});

	it('accepts storage table keys', () => {
		const c = parseConfig({
			Servers: [{ pmadb: 'phpmyadmin', controluser: 'pma', bookmarktable: 'pma__bookmark' }]
		});
		expect(c.Servers[0]).toMatchObject({
			pmadb: 'phpmyadmin',
			controluser: 'pma',
			bookmarktable: 'pma__bookmark',
			relation: ''
		});
	});

	it('keeps unknown keys', () => {
		const c = parseConfig({ SomethingElse: 1, Servers: [{ Foo: 'bar' }] });
		expect((c as Record<string, unknown>).SomethingElse).toBe(1);
		expect((c.Servers[0] as Record<string, unknown>).Foo).toBe('bar');
	});

	it('rejects invalid values', () => {
		expect(() => parseConfig({ MaxRows: 'many' })).toThrow(ConfigError);
		expect(() => parseConfig({ Servers: [{ auth_type: 'magic' }] })).toThrow(
			/Servers\.0\.auth_type/
		);
		expect(() => parseConfig({ LoginCookieValidity: 0 })).toThrow(ConfigError);
	});

	it('rejects ServerDefault pointing to a missing server', () => {
		expect(() => parseConfig({ ServerDefault: 3, Servers: [{}] })).toThrow(/ServerDefault/);
	});

	it('refuses signon auth without trusted proxies (headers from anyone would be trusted)', () => {
		expect(() => parseConfig({ Servers: [{ auth_type: 'signon' }] })).toThrow(
			/Servers\.0\.Signon\.identity\.trustedProxies/
		);
		expect(() =>
			parseConfig({
				Servers: [{ auth_type: 'signon', Signon: { identity: { trustedProxies: [] } } }]
			})
		).toThrow(ConfigError);
		expect(() =>
			parseConfig({
				Servers: [
					{ auth_type: 'signon', Signon: { identity: { trustedProxies: ['10.0.0.0/33'] } } }
				]
			})
		).toThrow(/IP address or a CIDR range/);
	});

	it('accepts signon auth with trusted proxies and fills the header defaults', () => {
		const [s] = parseConfig({
			Servers: [
				{ auth_type: 'signon', Signon: { identity: { trustedProxies: ['10.0.0.0/8', 'fd00::1'] } } }
			]
		}).Servers;
		expect(s.Signon?.identity).toEqual({
			type: 'trusted-header',
			userHeader: 'x-auth-request-user',
			emailHeader: 'x-auth-request-email',
			groupsHeader: 'x-auth-request-groups',
			trustedProxies: ['10.0.0.0/8', 'fd00::1']
		});
	});

	it('fills the Kubernetes authorisation defaults', () => {
		const [s] = parseConfig({
			Servers: [
				{
					auth_type: 'signon',
					Signon: {
						identity: { trustedProxies: ['10.0.0.0/8'] },
						authorize: { type: 'kubernetes-sar', namespace: 'review-123' }
					}
				}
			]
		}).Servers;
		expect(s.Signon?.authorize).toEqual({
			type: 'kubernetes-sar',
			namespace: 'review-123',
			resource: { group: '', resource: 'pods', verb: 'get' },
			userPrefix: '',
			groupsPrefix: '',
			cacheSeconds: 60,
			tokenFile: '/var/run/secrets/kubernetes.io/serviceaccount/token',
			caFile: '/var/run/secrets/kubernetes.io/serviceaccount/ca.crt'
		});
	});

	it('rejects a Kubernetes authorisation without a valid namespace', () => {
		const withAuthorize = (authorize: unknown) =>
			parseConfig({
				Servers: [
					{ auth_type: 'signon', Signon: { identity: { trustedProxies: ['10.0.0.1'] }, authorize } }
				]
			});
		expect(() => withAuthorize({ type: 'kubernetes-sar' })).toThrow(
			/Servers\.0\.Signon\.authorize\.namespace/
		);
		expect(() => withAuthorize({ type: 'kubernetes-sar', namespace: 'Review_123' })).toThrow(
			/DNS-1123/
		);
		expect(() =>
			withAuthorize({ type: 'kubernetes-sar', namespace: 'r', apiServer: 'ftp://x' })
		).toThrow(/apiServer/);
	});

	it('rejects Signon.authorize on a server that does not use signon', () => {
		expect(() =>
			parseConfig({
				Servers: [
					{
						auth_type: 'cookie',
						Signon: {
							identity: { trustedProxies: ['10.0.0.1'] },
							authorize: { type: 'kubernetes-sar', namespace: 'review-123' }
						}
					}
				]
			})
		).toThrow(/only applies to auth_type "signon"/);
	});

	it('leaves the audit log off unless AuditLog is set', () => {
		expect(parseConfig({}).AuditLog).toBeUndefined();
	});

	it('fills the AuditLog defaults', () => {
		expect(parseConfig({ AuditLog: { target: 'stdout' } }).AuditLog).toEqual({
			target: 'stdout',
			includeValues: false,
			sessionIdleMinutes: 30,
			maxSqlLength: 4096
		});
	});

	it('refuses a file audit log without a path', () => {
		expect(() => parseConfig({ AuditLog: { target: 'file' } })).toThrow(ConfigError);
		expect(() => parseConfig({ AuditLog: { target: 'syslog' } })).toThrow(ConfigError);
	});

	it('resolves the audit log path from the config file directory', () => {
		const c = parseConfig({ AuditLog: { target: 'file', path: 'logs/audit.jsonl' } }, '/etc/sma');
		expect(c.AuditLog).toMatchObject({ target: 'file', path: '/etc/sma/logs/audit.jsonl' });
	});

	describe('ServerDiscovery', () => {
		const discovery = (extra: Record<string, unknown> = {}) => ({
			type: 'kubernetes',
			namespaceSelector: 'env=review',
			serviceSelector: 'app.kubernetes.io/name=mysql',
			secret: { name: 'mysql-auth', passwordKey: 'mysql-root-password' },
			server: { Signon: { identity: { trustedProxies: ['10.0.0.0/8'] } } },
			...extra
		});

		it('fills the defaults and starts without a default server', () => {
			const c = parseConfig({ ServerDiscovery: discovery() });
			expect(c.Servers).toEqual([]);
			expect(c.ServerDiscovery).toMatchObject({
				port: 'mysql',
				host: '{service}.{namespace}.svc',
				verbose: '{namespace}',
				refreshSeconds: 30,
				secret: { user: 'root' },
				authorize: { type: 'kubernetes-sar', resource: { resource: 'pods', verb: 'get' } }
			});
		});

		it('keeps the configured servers', () => {
			const c = parseConfig({ Servers: [{ host: 'db' }], ServerDiscovery: discovery() });
			expect(c.Servers.map((s) => s.host)).toEqual(['db']);
		});

		it('resolves the SQLite storage path for discovered servers too', () => {
			const c = parseConfig(
				{
					ConfigStorage: { type: 'sqlite', path: 'var/storage.sqlite' },
					ServerDiscovery: discovery()
				},
				'/etc/sma'
			);
			expect(c.ConfigStorage?.path).toBe('/etc/sma/var/storage.sqlite');
		});

		it('refuses discovered servers without the SSO proxy addresses', () => {
			expect(() => parseConfig({ ServerDiscovery: discovery({ server: {} }) })).toThrow(
				/ServerDiscovery\.server\.Signon\.identity\.trustedProxies/
			);
		});

		it.each(['auth_type', 'host', 'password', 'discovered'])(
			'refuses %s in the discovered server settings',
			(key) => {
				const server = { ...discovery().server, [key]: 'x' };
				expect(() => parseConfig({ ServerDiscovery: discovery({ server }) })).toThrow(
					`ServerDiscovery.server.${key}: set by discovery`
				);
			}
		);

		it('refuses Signon.authorize in the server settings (it is ServerDiscovery.authorize)', () => {
			const server = {
				Signon: {
					identity: { trustedProxies: ['10.0.0.1'] },
					authorize: { type: 'kubernetes-sar' }
				}
			};
			expect(() => parseConfig({ ServerDiscovery: discovery({ server }) })).toThrow(
				/use ServerDiscovery\.authorize/
			);
		});

		it('refuses unknown placeholders', () => {
			expect(() => parseConfig({ ServerDiscovery: discovery({ verbose: '{pod}' }) })).toThrow(
				/allowed placeholders/
			);
		});

		it('refuses a discovery marker on a configured server', () => {
			expect(() =>
				parseConfig({ Servers: [{ discovered: { id: 'k8s:a/b', namespace: 'a', service: 'b' } }] })
			).toThrow(/Servers\.0\.discovered/);
		});
	});

	it('does not share default objects between calls', () => {
		const a = parseConfig({});
		a.ForeignKeyDropdownOrder.push('x');
		expect(parseConfig({}).ForeignKeyDropdownOrder).toEqual(['content-id', 'id-content']);
	});
});

describe('loadConfig', () => {
	let dir: string;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'sma-config-'));
	});
	afterEach(() => rmSync(dir, { recursive: true, force: true }));

	it('returns defaults when the file is missing', () => {
		expect(loadConfig(join(dir, 'nope.json')).MaxRows).toBe(25);
	});

	it('loads a JSON file', () => {
		const p = join(dir, 'config.json');
		writeFileSync(p, JSON.stringify({ MaxRows: 100, Servers: [{ host: 'x' }] }));
		const c = loadConfig(p);
		expect(c.MaxRows).toBe(100);
		expect(c.Servers[0].host).toBe('x');
	});

	it('throws ConfigError on malformed JSON', () => {
		const p = join(dir, 'config.json');
		writeFileSync(p, '{ nope');
		expect(() => loadConfig(p)).toThrow(ConfigError);
	});

	it('throws ConfigError on invalid content', () => {
		const p = join(dir, 'config.json');
		writeFileSync(p, JSON.stringify({ MaxRows: -1 }));
		expect(() => loadConfig(p)).toThrow(/MaxRows/);
	});
});

describe('getConfigPath', () => {
	it('honours SMA_CONFIG', () => {
		expect(getConfigPath({ SMA_CONFIG: '/etc/sma.json' })).toBe('/etc/sma.json');
	});
	it('defaults to config.json in cwd', () => {
		expect(getConfigPath({})).toBe(join(process.cwd(), 'config.json'));
	});
});

describe('Portal (svelteMultiAdmin back-link)', () => {
	it('is absent by default', () => {
		expect(parseConfig({ Servers: [] }).Portal).toBeUndefined();
	});
	it('takes an http(s) url and defaults the label', () => {
		expect(
			parseConfig({ Servers: [], Portal: { url: 'https://admin.example.com' } }).Portal
		).toEqual({
			url: 'https://admin.example.com',
			label: 'Portal'
		});
		expect(
			parseConfig({ Servers: [], Portal: { url: 'http://localhost:3000/', label: 'Admin portal' } })
				.Portal?.label
		).toBe('Admin portal');
	});
	it.each(['javascript:alert(1)', 'data:text/html,x', 'ftp://x.example', 'not a url', ''])(
		'rejects %j: the value ends up in an href',
		(url: string) => {
			expect(() => parseConfig({ Servers: [], Portal: { url } })).toThrow();
		}
	);
});
