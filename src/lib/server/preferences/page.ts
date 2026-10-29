import { N_ } from '#lib/i18n/index.ts';
/**
 * Glue of the `/server/settings` pages: serializable form views built from the descriptor list and the
 * save/import/reset operations on the stored preferences.
 */
import type { Cookies } from '@sveltejs/kit';
import { getConfig } from '#lib/server/config/index.ts';
import { DEVELOPER_KEYS, FIELD_BY_PATH, formById, type PrefForm } from '#lib/preferences/forms.ts';
import type { FieldDef, FieldValue } from '#lib/preferences/fields.ts';
import {
	allowedKeys,
	coerceFormValue,
	coerceStored,
	dropExactDefaults,
	parseImport,
	serverDefault,
	valuesEqual,
	type PrefData
} from '#lib/preferences/logic.ts';
import { loadPrefs, savePrefs, type LoadedPrefs } from './store.ts';

export interface FieldView {
	path: string;
	type: FieldDef['type'];
	label: string;
	help?: string;
	comment?: string;
	options?: { value: string; label: string }[];
	min?: number;
	/** Server default in the form's string model (see `toFormString`). */
	serverDefault: string;
	/** Current effective value (stored preference or the default). */
	value: string;
	/** A stored preference exists for this field. */
	custom: boolean;
}

export interface SectionView {
	id: string;
	title: string;
	description?: string;
	fields: FieldView[];
}

export interface FormView {
	id: string;
	title: string;
	sections: SectionView[];
}

/** Value as the HTML form models it: bool `1`/`0`, list one entry per line, everything else a string. */
export function toFormString(def: FieldDef, v: FieldValue): string {
	if (def.type === 'bool') return v ? '1' : '0';
	if (def.type === 'list') return Array.isArray(v) ? v.join('\n') : '';
	return String(v);
}

const base = () => getConfig() as unknown as Record<string, unknown>;

/** The preference form with the Developer section added when enabled. */
function effectiveForm(form: PrefForm, developerTab: boolean): PrefForm {
	if (form.id !== 'features' || !developerTab) return form;
	return {
		...form,
		sections: [
			...form.sections,
			{
				id: 'Developer',
				title: N_('Developer'),
				keys: DEVELOPER_KEYS,
				description: N_('Settings for phpMyAdmin developers.')
			}
		]
	};
}

export function buildFormView(form: PrefForm, prefs: PrefData, serverIndex: number): FormView {
	const config = getConfig();
	const b = base();
	const allowed = allowedKeys(config.UserprefsDisallow, config.UserprefsDeveloperTab);
	const full = effectiveForm(form, config.UserprefsDeveloperTab);
	const sections: SectionView[] = [];
	for (const s of full.sections) {
		const fields: FieldView[] = [];
		for (const path of s.keys) {
			const def = FIELD_BY_PATH.get(path);
			if (!def || !allowed.has(path)) continue;
			const sd = serverDefault(def, b, serverIndex);
			const stored = path in prefs ? coerceStored(def, prefs[path]) : null;
			const current = stored?.ok ? stored.value : sd;
			fields.push({
				path,
				type: def.type,
				label: def.label,
				help: def.help,
				comment: def.comment,
				options: def.options?.map((o) => ({ value: String(o.value), label: o.label })),
				min: def.min,
				serverDefault: toFormString(def, sd),
				value: toFormString(def, current),
				custom: stored?.ok === true && !valuesEqual(stored.value, sd)
			});
		}
		if (fields.length > 0)
			sections.push({ id: s.id, title: s.title, description: s.description, fields });
	}
	return { id: full.id, title: full.title, sections };
}

export async function loadFormPage(locals: App.Locals, cookies: Cookies, formId: string) {
	const form = formById(formId);
	if (!form) return null;
	const prefs = await loadPrefs(locals, cookies);
	return { form: buildFormView(form, prefs.data, locals.serverIndex), storage: storageInfo(prefs) };
}

export function storageInfo(prefs: LoadedPrefs) {
	return { type: prefs.type, unavailable: prefs.unavailable, mtime: prefs.mtime };
}

export type SaveResult =
	| { ok: true }
	| { ok: false; errors: Record<string, string>; values: Record<string, string>; message?: string };

/** Validate and store the posted values of one form. */
export async function saveForm(
	locals: App.Locals,
	cookies: Cookies,
	formId: string,
	fd: FormData,
	secure: boolean
): Promise<SaveResult> {
	const form = formById(formId);
	if (!form) return { ok: false, errors: {}, values: {}, message: locals.i18n.t('Unknown form') };
	const prefs = await loadPrefs(locals, cookies);
	const view = buildFormView(form, prefs.data, locals.serverIndex);
	const b = base();

	const next: PrefData = { ...prefs.data };
	const errors: Record<string, string> = {};
	const values: Record<string, string> = {};
	for (const section of view.sections) {
		for (const f of section.fields) {
			const def = FIELD_BY_PATH.get(f.path)!;
			const raw = fd.get(f.path);
			const posted = typeof raw === 'string' ? raw : null;
			values[f.path] = posted ?? f.value;
			const c = coerceFormValue(def, posted);
			if (!c.ok) {
				errors[f.path] = locals.i18n.t(c.error, { min: def.min ?? 0 });
				continue;
			}
			// MaxDbList & co: users cannot set a higher value than the server
			if (
				def.type === 'number' &&
				['MaxDbList', 'MaxTableList', 'QueryHistoryMax'].includes(f.path) &&
				typeof c.value === 'number' &&
				c.value > Number(f.serverDefault)
			) {
				errors[f.path] = locals.i18n.t('Users cannot set a higher value');
				continue;
			}
			if (valuesEqual(c.value, serverDefault(def, b, locals.serverIndex))) delete next[f.path];
			else next[f.path] = c.value;
		}
	}
	if (Object.keys(errors).length > 0) return { ok: false, errors, values };
	const error = await savePrefs(locals, cookies, next, secure);
	if (error) return { ok: false, errors: {}, values, message: error };
	return { ok: true };
}

export interface ImportOutcome {
	ok: boolean;
	error?: string;
	count?: number;
	dropped?: string[];
}

export async function importPrefs(
	locals: App.Locals,
	cookies: Cookies,
	text: string,
	merge: boolean,
	secure: boolean
): Promise<ImportOutcome> {
	const config = getConfig();
	const opts = {
		disallow: config.UserprefsDisallow,
		developerTab: config.UserprefsDeveloperTab,
		base: base(),
		serverIndex: locals.serverIndex
	};
	const parsed = parseImport(text, opts);
	if (!parsed.ok) return { ok: false, error: locals.i18n.t(parsed.error) };
	const existing = (await loadPrefs(locals, cookies)).data;
	// the two-factor setting is only changed on its own page (an imported file must not disable it)
	const imported = { ...parsed.data };
	delete imported['2fa'];
	const keep = existing['2fa'] === undefined ? {} : { '2fa': existing['2fa'] };
	const current = merge ? existing : {};
	const next = {
		...dropExactDefaults({ ...current, ...imported }, opts.base, locals.serverIndex),
		...keep
	};
	const error = await savePrefs(locals, cookies, next, secure);
	if (error) return { ok: false, error };
	return { ok: true, count: Object.keys(parsed.data).length, dropped: parsed.dropped };
}

export async function resetPrefs(
	locals: App.Locals,
	cookies: Cookies,
	secure: boolean
): Promise<string | null> {
	// resetting the preferences keeps the two-factor setting
	const existing = (await loadPrefs(locals, cookies)).data;
	return savePrefs(
		locals,
		cookies,
		existing['2fa'] === undefined ? {} : { '2fa': existing['2fa'] },
		secure
	);
}
