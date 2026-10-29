/** Shared shapes of the column transformation plugins (client-safe, pure). */

/** What an output transformation renders into a cell. Never raw HTML: the UI draws each kind. */
export type Transformed =
	| { type: 'text'; text: string; title?: string }
	| { type: 'link'; href: string; text: string; title?: string; blank?: boolean }
	| {
			type: 'image';
			src: string;
			href: string;
			alt: string;
			width?: number;
			height?: number;
	  }
	| { type: 'code'; language: 'sql' | 'json' | 'xml'; text: string }
	| { type: 'frame'; srcdoc: string };

/** The raw cell value handed to a plugin. */
export interface TransformInput {
	/** Text of the value; binary values appear as `0x<hex>` (phpMyAdmin shows them that way). */
	text: string;
	/** The bytes of a BINARY / BLOB value. */
	bytes?: Uint8Array;
}

export interface OutputContext {
	column: { name: string; isInt: boolean; isBinary: boolean };
	/**
	 * URL of the transformation wrapper streaming this cell (null when the row is not addressable).
	 * `extra` adds query parameters (`ct`, `cn`).
	 */
	wrapper: (extra?: Record<string, string>) => string | null;
	/** Text of another column of the same row (Download's file name column). */
	rowValue: (column: string) => string | null;
}

export interface PluginInfo {
	/** Lower-case file stem, e.g. `text_plain_dateformat`. */
	id: string;
	/** `Text/Plain` (as listed in the overview). */
	mime: string;
	/** Third part of the file name: `Dateformat`. */
	name: string;
	/** getName(): `Date Format`. */
	title: string;
	description: string;
	/** Not usable (stored values are kept, nothing is applied). */
	unsupported?: boolean;
}

export interface OutputPlugin extends PluginInfo {
	/** Directory part of the stored key: `output/` for Output plugins, none for the root ones. */
	dir: 'output' | '';
	apply(input: TransformInput, options: string[], ctx: OutputContext): Transformed;
}

export type InputWidget = 'default' | 'text' | 'file' | 'image' | 'editor';

export interface InputResult {
	value: string;
	/** Validation message; the save is refused. */
	error?: string;
}

export interface InputPlugin extends PluginInfo {
	widget: InputWidget;
	/** Editor flavour for `editor` widgets. */
	language?: 'json' | 'sql' | 'xml';
	/** Value shown in the form for a stored value. */
	toForm?: (stored: string, ctx: { isBinary: boolean }) => string;
	/** Convert the submitted value before it is stored. */
	apply: (value: string, options: string[], ctx: { isBinary: boolean }) => InputResult;
}
