/**
 * Export form defaults: libraries/config.default.php `$cfg['Export']` (overridable in config.json
 * under `Export`) merged with the default of every plugin option. Keys are the phpMyAdmin form
 * field names so templates stay interchangeable: `what`, `quick_or_custom`, `<format>_<option>`, ...
 */
import { EXPORT_CHARSETS } from './sink.ts';
import type { ExportPlugin, ExportScope } from './types.ts';

export type FormValue = string | boolean | string[];
export type FormDefaults = Record<string, FormValue>;

export const FILENAME_TEMPLATE_KEY: Record<ExportScope, string> = {
	server: 'file_template_server',
	database: 'file_template_database',
	table: 'file_template_table',
	raw: 'file_template_raw'
};

const FILENAME_FALLBACK: Record<ExportScope, string> = {
	server: '@SERVER@',
	database: '@DATABASE@',
	table: '@TABLE@',
	raw: '@DATABASE@'
};

const asString = (v: unknown, fallback: string) =>
	typeof v === 'string' || typeof v === 'number' ? String(v) : fallback;

export const COMPRESSIONS = ['none', 'gzip', 'zip'] as const;

export function buildDefaults(
	cfg: Record<string, unknown>,
	plugins: ExportPlugin[],
	scope: ExportScope
): FormDefaults {
	const method = cfg.method === 'custom' ? 'custom' : 'quick';
	const charset = asString(cfg.charset, '');
	const compression = asString(cfg.compression, 'none');
	const defaults: FormDefaults = {
		quick_or_custom: method,
		what: asString(cfg.format, 'sql'),
		allrows: '1',
		limit_from: '0',
		limit_to: '',
		output_format: cfg.asfile === false ? 'astext' : 'sendit',
		filename_template: asString(cfg[FILENAME_TEMPLATE_KEY[scope]], FILENAME_FALLBACK[scope]),
		remember_template: cfg.remember_file_template === false ? false : true,
		charset: charset in EXPORT_CHARSETS ? charset : 'utf-8',
		compression: (COMPRESSIONS as readonly string[]).includes(compression) ? compression : 'none'
	};
	for (const p of plugins) {
		const sod = asString(cfg[`${p.id}_structure_or_data`], '');
		defaults[`${p.id}_structure_or_data`] = ['structure', 'data', 'structure_and_data'].includes(
			sod
		)
			? sod
			: p.supports.structure && p.supports.data
				? 'structure_and_data'
				: p.supports.structure
					? 'structure'
					: 'data';
		const own = p.options.find((o) => o.name === 'structure_or_data');
		if (own && !['structure', 'data', 'structure_and_data'].includes(sod)) {
			defaults[`${p.id}_structure_or_data`] = String(own.default);
		}
		for (const o of p.options) {
			if (o.name === 'structure_or_data') continue;
			const key = `${p.id}_${o.name}`;
			const configured = cfg[key];
			if (o.kind === 'bool')
				defaults[key] = typeof configured === 'boolean' ? configured : o.default;
			else if (o.kind === 'number')
				defaults[key] = asString(
					typeof configured === 'number' || typeof configured === 'string' ? configured : undefined,
					String(o.default)
				);
			else defaults[key] = asString(configured, String(o.default));
		}
	}
	return defaults;
}
