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
