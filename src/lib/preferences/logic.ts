import { N_ } from '#lib/i18n/index.ts';
/**
 * Pure user preference logic shared by the server (merge into the effective config, pmadb JSON) and
 * the settings UI: allow/disallow rules, value coercion, defaults diffing and JSON import/export.
 *
 * The persisted shape is phpMyAdmin's `pma__userconfig.config_data`: a flat JSON object keyed by
 * config path (`"MaxRows": 50`, `"Export/format": "csv"`), holding only values that differ from the
 * defaults.
 */
import { FIELDS, type FieldDef, type FieldValue } from './fields.ts';
import {
	ALL_FORM_KEYS,
	DEVELOPER_KEYS,
	EXTRA_ALLOWED_KEYS,
	FIELD_BY_PATH,
	PASSTHROUGH_KEYS
} from './forms.ts';

export type PrefData = Record<string, unknown>;

/** Never user-settable regardless of the forms (read before the user is known). */
export const NEVER_USER_SETTABLE = ['LoginCookieValidity'];

/** Keys whose user value may not exceed the server value (config.values.php `_userValidators`). */
export const UPPER_BOUND_KEYS = ['MaxDbList', 'MaxTableList', 'QueryHistoryMax'];

/** The set of paths a user may store: form keys + custom-handled ones - `UserprefsDisallow`. */
export function allowedKeys(disallow: readonly string[], developerTab: boolean): Set<string> {
	const set = new Set<string>([...ALL_FORM_KEYS, ...PASSTHROUGH_KEYS, ...EXTRA_ALLOWED_KEYS]);
	// the form lists `Servers/1/x`, which is stored as `Server/x`
	if (developerTab) for (const k of DEVELOPER_KEYS) set.add(k);
	for (const k of disallow) set.delete(k);
	for (const k of NEVER_USER_SETTABLE) set.delete(k);
	return set;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Read a `/`-separated path from a nested object. */
export function getPath(obj: unknown, path: string): unknown {
	let cur: unknown = obj;
	for (const part of path.split('/')) {
		if (!isPlainObject(cur)) return undefined;
		cur = cur[part];
	}
	return cur;
}

/** Write a `/`-separated path (creating intermediate objects), like Core::arrayWrite. */
export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
	const parts = path.split('/');
	let cur = obj;
	for (const part of parts.slice(0, -1)) {
		if (part === '__proto__' || part === 'constructor' || part === 'prototype') return;
		const next = cur[part];
		if (isPlainObject(next)) cur = next;
		else {
			const created: Record<string, unknown> = {};
			cur[part] = created;
			cur = created;
		}
	}
	const last = parts[parts.length - 1];
	if (last === '__proto__' || last === 'constructor' || last === 'prototype') return;
	cur[last] = value;
}

export type Coerced = { ok: true; value: FieldValue } | { ok: false; error: string };

const fail = (error: string): Coerced => ({ ok: false, error });

/** Validate a stored (JSON) value against its descriptor. */
export function coerceStored(def: FieldDef, raw: unknown): Coerced {
	switch (def.type) {
		case 'bool':
			return typeof raw === 'boolean' ? { ok: true, value: raw } : fail(N_('Not a boolean'));
		case 'number': {
			const n = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
			if (typeof n !== 'number' || !Number.isInteger(n)) return fail(N_('Not an integer'));
			if (def.min !== undefined && n < def.min) return fail(N_('Must be at least {min}'));
			return { ok: true, value: n };
		}
		case 'text':
			return typeof raw === 'string' ? { ok: true, value: raw } : fail(N_('Not a string'));
		case 'select': {
			const hit = def.options?.find(
				(o) => o.value === raw || (typeof raw !== 'object' && String(o.value) === String(raw))
			);
			return hit ? { ok: true, value: hit.value as FieldValue } : fail(N_('Not an allowed value'));
		}
		case 'list':
			return Array.isArray(raw) && raw.every((x) => typeof x === 'string')
				? { ok: true, value: raw as string[] }
				: fail(N_('Not a list'));
	}
}

/** Parse the string a HTML form posts for a field. */
export function coerceFormValue(def: FieldDef, raw: string | null): Coerced {
	if (raw === null) return fail(N_('Missing value'));
	switch (def.type) {
		case 'bool':
			return raw === '1' || raw === '0'
				? { ok: true, value: raw === '1' }
				: fail(N_('Not a boolean'));
		case 'number': {
			if (raw.trim() === '' || !/^-?\d+$/.test(raw.trim())) return fail(N_('Must be an integer'));
			return coerceStored(def, Number(raw.trim()));
		}
		case 'text':
			return { ok: true, value: raw };
		case 'select': {
			const hit = def.options?.find((o) => String(o.value) === raw);
			return hit ? { ok: true, value: hit.value as FieldValue } : fail(N_('Not an allowed value'));
		}
		case 'list':
			return {
				ok: true,
				value: raw
					.split(/\r?\n/)
					.map((l) => l.trim())
					.filter((l) => l !== '')
			};
	}
}

export function valuesEqual(a: unknown, b: unknown): boolean {
	if (Array.isArray(a) && Array.isArray(b))
		return a.length === b.length && a.every((x, i) => x === b[i]);
	return a === b;
}

/** The server-side default of a field: the loaded config value, else the phpMyAdmin default. */
export function serverDefault(
	def: FieldDef,
	base: Record<string, unknown>,
	serverIndex = 1
): FieldValue {
	let v: unknown;
	if (def.path.startsWith('Server/')) {
		const servers = base.Servers;
		const server = Array.isArray(servers) ? servers[serverIndex - 1] : undefined;
		v = isPlainObject(server) ? server[def.path.slice('Server/'.length)] : undefined;
	} else {
		v = getPath(base, def.path);
	}
	if (v === undefined) return def.default;
	// config.json may carry an out-of-domain value; fall back to the descriptor default then
	const c = coerceStored(def, v);
	return c.ok ? c.value : def.default;
}

/**
 * Reduce stored data to what may take effect: allowed keys only, values valid for their descriptor and
 * within the upper bound of the server value. Unknown-descriptor keys (passthrough) are kept as they are.
 */
export function sanitizePrefs(
	data: PrefData,
	opts: {
		disallow: readonly string[];
		developerTab: boolean;
		base: Record<string, unknown>;
		serverIndex?: number;
	}
): PrefData {
	const allowed = allowedKeys(opts.disallow, opts.developerTab);
	const out: PrefData = {};
	for (const [path, value] of Object.entries(data)) {
		if (!allowed.has(path)) continue;
		const def = FIELD_BY_PATH.get(path);
		if (!def) {
			out[path] = value;
			continue;
		}
		const c = coerceStored(def, value);
		if (!c.ok) continue;
		if (UPPER_BOUND_KEYS.includes(path)) {
			const limit = serverDefault(def, opts.base, opts.serverIndex);
			if (typeof c.value === 'number' && typeof limit === 'number' && c.value > limit) continue;
		}
		out[path] = c.value;
	}
	return out;
}

/** Plain parse of the stored JSON text. Anything that is not an object is treated as empty. */
export function parseConfigData(text: unknown): PrefData {
	if (typeof text !== 'string') return {};
	try {
		const v: unknown = JSON.parse(text);
		return isPlainObject(v) ? v : {};
	} catch {
		return {};
	}
}

/** Pretty JSON as phpMyAdmin's "Save as JSON file" export (JSON_PRETTY_PRINT: four spaces). */
export function exportJson(data: PrefData): string {
	const keys = Object.keys(data);
	return keys.length === 0 ? '[]' : JSON.stringify(data, null, 4);
}

export type ImportResult =
	{ ok: true; data: PrefData; dropped: string[] } | { ok: false; error: string };

/**
 * Parse an imported settings file. Accepts phpMyAdmin's flat export (`"Export/format": "csv"`) and,
 * for convenience, nested objects (`{"Export": {"format": "csv"}}`). Keys that are not allowed or whose
 * value is invalid are reported in `dropped`; values equal to the server default are not stored.
 */
export function parseImport(
	text: string,
	opts: {
		disallow: readonly string[];
		developerTab: boolean;
		base: Record<string, unknown>;
		serverIndex?: number;
	}
): ImportResult {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return { ok: false, error: N_('Could not import configuration') };
	}
	// PHP encodes an empty array as `[]`
	if (Array.isArray(parsed) && parsed.length === 0) parsed = {};
	if (!isPlainObject(parsed)) return { ok: false, error: N_('Could not import configuration') };

	const flat: PrefData = {};
	const allKnown = new Set<string>([
		...FIELDS.map((f) => f.path),
		...PASSTHROUGH_KEYS,
		...EXTRA_ALLOWED_KEYS
	]);
	const walk = (obj: Record<string, unknown>, prefix: string) => {
		for (const [k, v] of Object.entries(obj)) {
			const path = prefix + k;
			if (isPlainObject(v) && !allKnown.has(path)) walk(v, path + '/');
			else flat[path] = v;
		}
	};
	walk(parsed, '');
	// `Servers/1/hide_db` style keys of older exports
	for (const k of ['hide_db', 'only_db']) {
		if (`Servers/1/${k}` in flat) {
			flat[`Server/${k}`] = flat[`Servers/1/${k}`];
			delete flat[`Servers/1/${k}`];
		}
	}

	const cleaned = sanitizePrefs(flat, opts);
	const dropped = Object.keys(flat).filter((k) => !(k in cleaned));
	return { ok: true, data: dropExactDefaults(cleaned, opts.base, opts.serverIndex), dropped };
}

/** Remove entries equal to the server default (phpMyAdmin stores only differences). */
export function dropExactDefaults(
	data: PrefData,
	base: Record<string, unknown>,
	serverIndex = 1
): PrefData {
	const out: PrefData = {};
	for (const [path, value] of Object.entries(data)) {
		const def = FIELD_BY_PATH.get(path);
		if (def && valuesEqual(value, serverDefault(def, base, serverIndex))) continue;
		out[path] = value;
	}
	return out;
}

/**
 * Overlay sanitized prefs on a config object (returns a deep-enough copy: only the touched branches are
 * cloned). `Server/*` keys go to the active server definition.
 */
export function overlayPrefs<T extends Record<string, unknown>>(
	base: T,
	prefs: PrefData,
	serverIndex = 1
): T {
	const out: Record<string, unknown> = { ...base };
	const cloned = new Set<string>();
	const cloneBranch = (parts: string[]) => {
		let cur = out;
		let key = '';
		for (const part of parts) {
			key += '/' + part;
			const next = cur[part];
			if (!cloned.has(key)) {
				cur[part] = isPlainObject(next) ? { ...next } : {};
				cloned.add(key);
			}
			cur = cur[part] as Record<string, unknown>;
		}
	};
	for (const [path, value] of Object.entries(prefs)) {
		if (path === 'lang' || path === '2fa') continue;
		if (path.startsWith('Server/')) {
			const servers = Array.isArray(out.Servers) ? [...(out.Servers as unknown[])] : [];
			const cur = servers[serverIndex - 1];
			if (isPlainObject(cur)) {
				servers[serverIndex - 1] = { ...cur, [path.slice('Server/'.length)]: value };
				out.Servers = servers;
			}
			continue;
		}
		const parts = path.split('/');
		if (parts.some((p) => p === '__proto__' || p === 'constructor' || p === 'prototype')) continue;
		cloneBranch(parts.slice(0, -1));
		setPath(out, path, value);
	}
	return out as T;
}

/** Fields of the descriptor list that differ from the server default for the given prefs. */
export function differingPaths(
	prefs: PrefData,
	base: Record<string, unknown>,
	serverIndex = 1
): string[] {
	return Object.keys(prefs).filter((p) => {
		const def = FIELD_BY_PATH.get(p);
		return def ? !valuesEqual(prefs[p], serverDefault(def, base, serverIndex)) : true;
	});
}
