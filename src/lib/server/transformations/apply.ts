/**
 * Apply the output transformations of a table to result rows (the data part of PhpMyAdmin\Display\Results
 * calling the plugins). Pure over the settings it is given, so it is testable without a storage.
 */
import type { Cell } from '#lib/components/results/format.ts';
import type { RowValue } from '#lib/server/table/unique-condition.ts';
import type { ColumnKind } from '#lib/table/column-kind.ts';
import { toHex } from '#lib/transformations/convert.ts';
import { getOptions } from '#lib/transformations/options.ts';
import { resolveOutput } from '#lib/transformations/registry.ts';
import type { OutputPlugin, TransformInput, Transformed } from '#lib/transformations/types.ts';
import type { MimeMap } from './column-info.ts';

/** Column index -> one transformed cell per row (null = show the raw cell). */
export type RowTransforms = Record<number, (Transformed | null)[]>;

/** URL of the wrapper endpoint for one cell. */
export function wrapperUrl(
	db: string,
	table: string,
	row: { where: string; sig: string },
	column: string,
	extra: Record<string, string> = {}
): string {
	const q = new URLSearchParams({ where: row.where, sig: row.sig, col: column, ...extra });
	return `/db/${encodeURIComponent(db)}/table/${encodeURIComponent(table)}/transformation/wrapper?${q}`;
}

export interface TransformTarget {
	name: string;
	kind: ColumnKind;
	/** Column of the base table the settings are looked up by. */
	settingsName: string;
}

interface RowAccess {
	/** Plugin input of the cell, null for SQL NULL. */
	input(col: number): TransformInput | null;
	/** Binary cell whose bytes are not available (SQL result sets only keep a preview). */
	hasBytes(col: number): boolean;
	wrapper(col: number, extra?: Record<string, string>): string | null;
}

/** Plugins that only need the wrapper URL, never the bytes. */
const WRAPPER_ONLY = (p: OutputPlugin) =>
	p.id.startsWith('image_') || p.id === 'application_octetstream_download';

function run(
	targets: TransformTarget[],
	rowCount: number,
	mime: MimeMap,
	access: (row: number) => RowAccess
): RowTransforms {
	const out: RowTransforms = {};
	targets.forEach((target, c) => {
		const settings = mime.get(target.settingsName);
		const plugin = resolveOutput(settings?.transformation);
		if (!settings || !plugin || plugin.unsupported) return;
		const options = getOptions(settings.transformation_options);
		const isBinary = target.kind === 'binary';
		const cells: (Transformed | null)[] = [];
		for (let r = 0; r < rowCount; r++) {
			const row = access(r);
			const input = row.input(c);
			if (input === null || (isBinary && !row.hasBytes(c) && !WRAPPER_ONLY(plugin))) {
				cells.push(null);
				continue;
			}
			cells.push(
				plugin.apply(input, options, {
					column: { name: target.name, isInt: target.kind === 'integer', isBinary },
					wrapper: (extra) => row.wrapper(c, extra),
					rowValue: (name) => {
						const i = targets.findIndex((t) => t.name === name);
						return i < 0 ? null : (row.input(i)?.text ?? null);
					}
				})
			);
		}
		out[c] = cells;
	});
	return out;
}

function rawInput(v: RowValue): TransformInput | null {
	if (v === null || v === undefined) return null;
	if (v instanceof Uint8Array) return { text: `0x${toHex(v)}`, bytes: v };
	return { text: String(v) };
}

/**
 * Transform the rows of a table browse. `rows` are the raw driver values (so binary columns keep
 * their bytes), `signed` the unique condition of each row.
 */
export function transformBrowseRows(opts: {
	db: string;
	table: string;
	mime: MimeMap;
	targets: TransformTarget[];
	rows: RowValue[][];
	signed: { where: string; sig: string }[];
}): RowTransforms {
	const { db, table, mime, targets, rows, signed } = opts;
	return run(targets, rows.length, mime, (r) => ({
		input: (c) => rawInput(rows[r][c]),
		hasBytes: () => true,
		wrapper: (c, extra) => wrapperUrl(db, table, signed[r], targets[c].settingsName, extra)
	}));
}

/** Transform an already converted result set (SQL console); binary cells have no bytes here. */
export function transformCells(opts: {
	db: string;
	table: string;
	mime: MimeMap;
	targets: TransformTarget[];
	rows: Cell[][];
	signed: ({ where: string; sig: string } | undefined)[] | null;
}): RowTransforms {
	const { db, table, mime, targets, rows, signed } = opts;
	return run(targets, rows.length, mime, (r) => ({
		input: (c) => {
			const cell = rows[r][c];
			if (cell === null) return null;
			if (typeof cell === 'string') return { text: cell };
			return { text: `0x${cell.preview}` };
		},
		hasBytes: (c) => typeof rows[r][c] === 'string',
		wrapper: (c, extra) => {
			const key = signed?.[r];
			return key ? wrapperUrl(db, table, key, targets[c].settingsName, extra) : null;
		}
	}));
}

/** Fields of a result that come from `db.table`, as transform targets. */
export function fieldTargets(
	fields: { name: string; orgName: string; orgTable: string; db: string; kind: ColumnKind }[],
	db: string,
	table: string
): TransformTarget[] {
	return fields.map((f) => ({
		name: f.name,
		kind: f.kind,
		// expressions and columns of other tables get a name no setting can match
		settingsName: f.db === db && f.orgTable === table && f.orgName ? f.orgName : '\0'
	}));
}
