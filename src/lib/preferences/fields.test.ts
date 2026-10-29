import { describe, expect, it } from 'vitest';
import { parseConfig } from '#lib/server/config/loader.ts';
import { FIELDS } from './fields.ts';
import { ALL_FORM_KEYS, FIELD_BY_PATH, PASSTHROUGH_KEYS, PREF_FORMS, formKeys } from './forms.ts';
import { coerceStored, getPath } from './logic.ts';

describe('preference descriptors', () => {
	it('has a descriptor for every key of the user forms (except passthrough ones)', () => {
		const missing = ALL_FORM_KEYS.filter(
			(k) => !FIELD_BY_PATH.has(k) && !PASSTHROUGH_KEYS.includes(k)
		);
		expect(missing).toEqual([]);
	});

	it('lists no key twice inside a form and has no orphan descriptor', () => {
		for (const form of PREF_FORMS) {
			const keys = formKeys(form);
			expect(new Set(keys).size, form.id).toBe(keys.length);
		}
		const used = new Set([...ALL_FORM_KEYS, 'DBG/sql']);
		expect(FIELDS.filter((f) => !used.has(f.path)).map((f) => f.path)).toEqual([]);
	});

	it('mirrors the phpMyAdmin form structure', () => {
		expect(PREF_FORMS.map((f) => f.id)).toEqual([
			'features',
			'sql',
			'navigation',
			'main',
			'export',
			'import'
		]);
		expect(formKeys(PREF_FORMS[0]).slice(0, 3)).toEqual([
			'VersionCheck',
			'NaturalOrder',
			'InitialSlidersState'
		]);
	});

	it('does not make LoginCookieValidity user-settable', () => {
		expect(FIELD_BY_PATH.has('LoginCookieValidity')).toBe(false);
		expect(ALL_FORM_KEYS).not.toContain('LoginCookieValidity');
	});

	it('uses defaults valid for the descriptor itself', () => {
		for (const f of FIELDS) {
			const c = coerceStored(f, f.default);
			expect(c.ok, `${f.path} default ${JSON.stringify(f.default)}`).toBe(true);
		}
	});

	it('agrees with the config schema defaults', () => {
		const config = parseConfig({}) as unknown as Record<string, unknown>;
		const mismatches: string[] = [];
		for (const f of FIELDS) {
			if (
				f.path.startsWith('Server/') ||
				f.path.startsWith('Export/') ||
				f.path.startsWith('Import/')
			)
				continue;
			const v = getPath(config, f.path);
			if (v === undefined) continue;
			if (JSON.stringify(v) !== JSON.stringify(f.default)) mismatches.push(f.path);
		}
		expect(mismatches).toEqual([]);
	});

	it('gives select fields options containing the default', () => {
		for (const f of FIELDS.filter((x) => x.type === 'select')) {
			expect(
				f.options?.some((o) => o.value === f.default),
				f.path
			).toBe(true);
		}
	});
});
