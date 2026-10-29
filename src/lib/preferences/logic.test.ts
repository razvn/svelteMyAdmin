import { describe, expect, it } from 'vitest';
import { parseConfig } from '#lib/server/config/loader.ts';
import { buildEffectiveConfig } from '#lib/server/preferences/effective.ts';
import { FIELD_BY_PATH } from './forms.ts';
import {
	allowedKeys,
	coerceFormValue,
	coerceStored,
	dropExactDefaults,
	exportJson,
	overlayPrefs,
	parseConfigData,
	parseImport,
	sanitizePrefs,
	serverDefault
} from './logic.ts';

/** A config_data row as phpMyAdmin writes it (note the escaped slashes of PHP json_encode). */
const PMA_SAMPLE = `{"MaxRows":50,"Export\\/format":"csv","Export\\/csv_separator":";","NavigationTreeEnableGrouping":false,"DefaultTabTable":"structure","ShowStats":false,"Console\\/Mode":"show","ThemeDefault":"pmahomme","lang":"fr","DefaultTransformations\\/Hex":["4"],"LoginCookieValidity":9999,"Bogus":1}`;

const base = parseConfig({}) as unknown as Record<string, unknown>;
const opts = { disallow: [] as string[], developerTab: false, base };

describe('allowed keys', () => {
	it('contains the form keys and the custom handled ones', () => {
		const a = allowedKeys([], false);
		expect(a.has('MaxRows')).toBe(true);
		expect(a.has('Export/format')).toBe(true);
		expect(a.has('ThemeDefault')).toBe(true);
		expect(a.has('2fa')).toBe(true);
		expect(a.has('DBG/sql')).toBe(false);
		expect(allowedKeys([], true).has('DBG/sql')).toBe(true);
	});

	it('applies UserprefsDisallow and never allows LoginCookieValidity', () => {
		const a = allowedKeys(['MaxRows', 'Export/format'], false);
		expect(a.has('MaxRows')).toBe(false);
		expect(a.has('Export/format')).toBe(false);
		expect(a.has('ShowStats')).toBe(true);
		expect(allowedKeys([], true).has('LoginCookieValidity')).toBe(false);
	});
});

describe('value coercion', () => {
	it('validates stored values by type', () => {
		const rows = FIELD_BY_PATH.get('MaxRows')!;
		expect(coerceStored(rows, 10)).toEqual({ ok: true, value: 10 });
		expect(coerceStored(rows, 0).ok).toBe(false);
		expect(coerceStored(rows, 'abc').ok).toBe(false);
		expect(coerceStored(FIELD_BY_PATH.get('ShowStats')!, 'yes').ok).toBe(false);
		expect(coerceStored(FIELD_BY_PATH.get('Export/format')!, 'nope').ok).toBe(false);
		expect(coerceStored(FIELD_BY_PATH.get('ProtectBinary')!, false)).toEqual({
			ok: true,
			value: false
		});
	});

	it('parses posted form strings', () => {
		expect(coerceFormValue(FIELD_BY_PATH.get('ShowStats')!, '0')).toEqual({
			ok: true,
			value: false
		});
		expect(coerceFormValue(FIELD_BY_PATH.get('MaxRows')!, '10')).toEqual({ ok: true, value: 10 });
		expect(coerceFormValue(FIELD_BY_PATH.get('MaxRows')!, '1.5').ok).toBe(false);
		expect(coerceFormValue(FIELD_BY_PATH.get('ProtectBinary')!, 'false')).toEqual({
			ok: true,
			value: false
		});
		expect(coerceFormValue(FIELD_BY_PATH.get('ForeignKeyDropdownOrder')!, 'a\n\n b \n')).toEqual({
			ok: true,
			value: ['a', 'b']
		});
	});
});

describe('merge rules', () => {
	it('keeps only allowed, valid keys', () => {
		const data = parseConfigData(PMA_SAMPLE);
		const out = sanitizePrefs(data, opts);
		expect(out).toMatchObject({
			MaxRows: 50,
			'Export/format': 'csv',
			NavigationTreeEnableGrouping: false,
			DefaultTabTable: 'structure',
			'Console/Mode': 'show',
			ThemeDefault: 'pmahomme',
			'DefaultTransformations/Hex': ['4']
		});
		expect(out).not.toHaveProperty('LoginCookieValidity');
		expect(out).not.toHaveProperty('Bogus');
	});

	it('drops disallowed keys', () => {
		const out = sanitizePrefs(parseConfigData(PMA_SAMPLE), { ...opts, disallow: ['MaxRows'] });
		expect(out).not.toHaveProperty('MaxRows');
		expect(out.ShowStats).toBe(false);
	});

	it('refuses values above the server limit of MaxDbList and friends', () => {
		const out = sanitizePrefs({ MaxDbList: 5000, MaxTableList: 10, QueryHistoryMax: 26 }, opts);
		expect(out).toEqual({ MaxTableList: 10 });
	});

	it('overlays flat paths onto the nested config without touching the base', () => {
		const prefs = sanitizePrefs(parseConfigData(PMA_SAMPLE), opts);
		const merged = overlayPrefs(base, prefs) as Record<string, unknown>;
		expect(merged.MaxRows).toBe(50);
		expect((merged.Export as Record<string, unknown>).format).toBe('csv');
		expect((merged.Console as Record<string, unknown>).Mode).toBe('show');
		expect(base.MaxRows).toBe(25);
		expect((base.Export as Record<string, unknown>).format).toBeUndefined();
	});

	it('refuses prototype pollution paths', () => {
		const merged = overlayPrefs(base, { '__proto__/polluted': 1, 'constructor/x': 1 });
		expect(({} as Record<string, unknown>).polluted).toBeUndefined();
		expect(merged).toBeDefined();
	});

	it('builds the effective config on a copy', () => {
		const cfg = parseConfig({});
		const eff = buildEffectiveConfig(cfg, { MaxRows: 10, 'Export/format': 'csv' }, 1);
		expect(eff.config.MaxRows).toBe(10);
		expect((eff.config.Export as Record<string, unknown>).format).toBe('csv');
		expect(cfg.MaxRows).toBe(25);
	});

	it('returns the very same config object when there are no prefs', () => {
		const cfg = parseConfig({});
		expect(buildEffectiveConfig(cfg, {}, 1).config).toBe(cfg);
		expect(buildEffectiveConfig(cfg, { LoginCookieValidity: 1 }, 1).config).toBe(cfg);
	});

	it('exposes Server/hide_db as a server override', () => {
		const cfg = parseConfig({});
		const eff = buildEffectiveConfig(cfg, { 'Server/hide_db': '^tmp_' }, 1);
		expect(eff.serverOverrides).toEqual({ hide_db: '^tmp_' });
	});

	it('uses the config.json value as the server default', () => {
		const cfg = parseConfig({ MaxRows: 100 }) as unknown as Record<string, unknown>;
		expect(serverDefault(FIELD_BY_PATH.get('MaxRows')!, cfg)).toBe(100);
		expect(serverDefault(FIELD_BY_PATH.get('Export/format')!, cfg)).toBe('sql');
		expect(dropExactDefaults({ MaxRows: 100, ShowStats: false }, cfg)).toEqual({
			ShowStats: false
		});
	});
});

describe('JSON import / export format', () => {
	it('reads the phpMyAdmin export format (flat keys)', () => {
		const res = parseImport(PMA_SAMPLE, opts);
		expect(res.ok).toBe(true);
		if (!res.ok) return;
		expect(res.data.MaxRows).toBe(50);
		expect(res.data['Export/format']).toBe('csv');
		expect(res.dropped.sort()).toEqual(['Bogus', 'LoginCookieValidity']);
	});

	it('drops values equal to the server default', () => {
		const res = parseImport('{"MaxRows":25,"ShowStats":false}', opts);
		expect(res).toMatchObject({ ok: true, data: { ShowStats: false } });
		if (res.ok) expect(res.data).not.toHaveProperty('MaxRows');
	});

	it('accepts nested objects and an empty PHP array', () => {
		const nested = parseImport('{"Export":{"format":"csv"},"MaxRows":10}', opts);
		expect(nested).toMatchObject({ ok: true, data: { 'Export/format': 'csv', MaxRows: 10 } });
		expect(parseImport('[]', opts)).toMatchObject({ ok: true, data: {} });
	});

	it('rejects garbage', () => {
		expect(parseImport('not json', opts).ok).toBe(false);
		expect(parseImport('"str"', opts).ok).toBe(false);
	});

	it('exports flat pretty JSON that imports back identically', () => {
		const data = { MaxRows: 10, 'Export/format': 'csv', ShowStats: false };
		const text = exportJson(data);
		expect(text).toBe(JSON.stringify(data, null, 4));
		expect(parseImport(text, opts)).toMatchObject({ ok: true, data });
		expect(exportJson({})).toBe('[]');
	});
});
