/**
 * Registry of the transformation plugins and the keys stored in `pma__column_info`.
 *
 * phpMyAdmin stores `mimetype` as `image_jpeg` and the plugin as its lower-cased file path:
 * `output/text_plain_dateformat.php`, `input/text_plain_iptolong.php` or (root plugins)
 * `text_plain_link.php`. svelteMyAdmin reads and writes the very same strings.
 */
import { INPUT_PLUGINS } from './input.ts';
import { OUTPUT_PLUGINS } from './output.ts';
import type { InputPlugin, OutputPlugin, PluginInfo } from './types.ts';

export { INPUT_PLUGINS, OUTPUT_PLUGINS };

/** Stored `transformation` value of an output plugin. */
export const outputKey = (p: OutputPlugin): string =>
	p.dir ? `${p.dir}/${p.id}.php` : `${p.id}.php`;

/** Stored `input_transformation` value of an input plugin. */
export const inputKey = (p: InputPlugin): string => `input/${p.id}.php`;

/** Lower-case plugin id of a stored value (tolerates old `.inc.php` / double underscore names). */
export function normalizeKey(stored: string): string {
	return stored
		.trim()
		.toLowerCase()
		.replace(/^(output|input)\//, '')
		.replace(/(\.inc)?\.php$/, '')
		.replace(/__+/g, '_');
}

export function resolveOutput(stored: string | null | undefined): OutputPlugin | null {
	if (!stored) return null;
	const id = normalizeKey(stored);
	return OUTPUT_PLUGINS.find((p) => p.id === id) ?? null;
}

export function resolveInput(stored: string | null | undefined): InputPlugin | null {
	if (!stored) return null;
	const id = normalizeKey(stored);
	return INPUT_PLUGINS.find((p) => p.id === id) ?? null;
}

/** Stored `mimetype` value of a media type: `Image/JPEG` -> `image_jpeg`. */
export const mimeValue = (mime: string): string => mime.toLowerCase().replace('/', '_');

/** Available media types in phpMyAdmin's order (Input, Output, root). */
export function mimeTypes(): string[] {
	const seen: string[] = [];
	for (const p of [...INPUT_PLUGINS, ...OUTPUT_PLUGINS]) {
		if (!seen.includes(p.mime)) seen.push(p.mime);
	}
	return seen;
}

/** `Date Format (text/plain: Dateformat)`, the option label of the transformation selects. */
export const pluginLabel = (p: PluginInfo): string =>
	`${p.title} (${p.mime.toLowerCase()}: ${p.name})${p.unsupported ? ' - not supported' : ''}`;

/** `Text/Plain: Dateformat`, as listed on the overview page. */
export const pluginListName = (p: PluginInfo): string => `${p.mime}: ${p.name}`;

export interface TransformationChoice {
	key: string;
	label: string;
	description: string;
	disabled: boolean;
}

export function outputChoices(): TransformationChoice[] {
	return OUTPUT_PLUGINS.map((p) => ({
		key: outputKey(p),
		label: pluginLabel(p),
		description: p.description,
		disabled: !!p.unsupported
	}));
}

export function inputChoices(): TransformationChoice[] {
	return INPUT_PLUGINS.map((p) => ({
		key: inputKey(p),
		label: pluginLabel(p),
		description: p.description,
		disabled: false
	}));
}
