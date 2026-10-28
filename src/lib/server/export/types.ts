/**
 * Export plugin contract, mirroring phpMyAdmin's libraries/classes/Plugins/ExportPlugin.php.
 *
 * The export framework (src/lib/server/export/run.ts) drives a plugin through these hooks in
 * the same order as phpMyAdmin's Export::exportServer/exportDatabase/exportTable:
 *
 *   header
 *     for each database:  dbHeader, dbCreate, (for each table: structure?, data?), routines?, events?, dbFooter
 *   footer
 *
 * Plugins only produce text/bytes through `ctx.write`; the framework handles streaming,
 * compression (gzip/zip), charset, file naming and templates. Hooks are optional except
 * `header`/`footer`-free formats may omit them too.
 */
import type { Connection } from '#lib/server/db/connection.ts';

/** What is being exported (phpMyAdmin's `$exportType`). */
export type ExportScope = 'server' | 'database' | 'table' | 'raw';

/** Structure/data selection per table (phpMyAdmin `what` + structure_or_data options). */
export type StructureOrData = 'structure' | 'data' | 'structure_and_data';

/** A plugin option rendered by the export form (phpMyAdmin OptionsPropertyItem subset). */
export type ExportOption =
	| { kind: 'bool'; name: string; label: string; default: boolean; group?: string }
	| { kind: 'text'; name: string; label: string; default: string; group?: string }
	| { kind: 'number'; name: string; label: string; default: number; group?: string }
	| {
			kind: 'select';
			name: string;
			label: string;
			default: string;
			choices: { value: string; label: string }[];
			group?: string;
	  }
	| {
			kind: 'radio';
			name: string;
			label: string;
			default: string;
			choices: { value: string; label: string }[];
			group?: string;
	  };

export type ExportOptionValues = Record<string, string | number | boolean>;

/** Column metadata of an exported result (subset of mysql2 FieldPacket + information_schema). */
export interface ExportField {
	name: string;
	/** Lower-case SQL type name, e.g. `int`, `varchar`, `blob`, `json`, `geometry`. */
	type: string;
	/** Full column type when known, e.g. `int(10) unsigned`, `enum('a','b')`. */
	columnType?: string;
	isBinary: boolean;
	isNumeric: boolean;
	nullable: boolean;
	isGenerated?: boolean;
}

/**
 * A data cell as streamed to plugins: `null` for SQL NULL, `Buffer` for binary columns,
 * string otherwise (numbers, decimals, dates and JSON arrive as their textual MySQL value).
 */
export type ExportCell = string | Buffer | null;

export interface ExportTableRef {
	db: string;
	table: string;
	/** Alias chosen in the export form (phpMyAdmin `aliases`), empty when none. */
	alias?: string;
	kind: 'table' | 'view';
}

export interface ExportContext {
	/** Append output. Strings are encoded with `charset` by the framework. */
	write(chunk: string | Uint8Array): Promise<void>;
	conn: Connection;
	scope: ExportScope;
	options: ExportOptionValues;
	/** `\n`, or `\r\n` for formats that require it (set by the plugin via `crlf`). */
	crlf: string;
	/** Server version info for version-specific syntax. */
	server: { version: string; isMariaDb: boolean; host: string };
	/** svelteMyAdmin version (for headers such as "-- phpMyAdmin SQL Dump"-like comments). */
	appVersion: string;
	/** Export start time (headers use it). */
	now: Date;
}

export interface ExportData {
	ref: ExportTableRef;
	fields: ExportField[];
	/** Rows streamed from the server. Consume once. */
	rows: AsyncIterable<ExportCell[]>;
	/** The SELECT that produced the rows (raw query exports, comments). */
	sql: string;
}

export interface ExportPlugin {
	id: string; // e.g. 'sql', 'csv', 'json'
	label: string; // shown in the format select
	extension: string; // without dot, e.g. 'sql'
	mimeType: string;
	/** Scopes the plugin can export (phpMyAdmin hides plugins per export type). */
	scopes: ExportScope[];
	/** Whether it exports structure, data or both (drives the structure/data radio). */
	supports: { structure: boolean; data: boolean };
	/** Line ending used by the plugin. */
	crlf?: '\n' | '\r\n';
	/** Binary formats (ods/odt/pdf/xlsx) build in memory and write once in `footer`. */
	binary?: boolean;
	options: ExportOption[];

	header?(ctx: ExportContext): Promise<void>;
	footer?(ctx: ExportContext): Promise<void>;
	dbHeader?(ctx: ExportContext, db: string, alias?: string): Promise<void>;
	dbFooter?(ctx: ExportContext, db: string): Promise<void>;
	dbCreate?(ctx: ExportContext, db: string, alias?: string): Promise<void>;
	structure?(ctx: ExportContext, ref: ExportTableRef, what: StructureOrData): Promise<void>;
	data?(ctx: ExportContext, data: ExportData): Promise<void>;
	routines?(ctx: ExportContext, db: string): Promise<void>;
	events?(ctx: ExportContext, db: string): Promise<void>;
	/** Called once after all tables of a db (SQL plugin: constraints, AUTO_INCREMENT, triggers). */
	dbAfterTables?(ctx: ExportContext, db: string, tables: ExportTableRef[]): Promise<void>;
}
