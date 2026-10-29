/**
 * Column transformation settings in `pma__column_info` (Transformations::getMime / setMime).
 * Everything degrades to "feature off" (null / false) when BrowseMIME is disabled or the
 * configuration storage is missing or unreachable.
 */
import { z } from 'zod';
import { escapeQualified } from '#lib/server/db/escape.ts';
import { withControl } from '#lib/server/table/control.ts';
import {
	inputKey,
	mimeTypes,
	mimeValue,
	outputKey,
	resolveInput,
	resolveOutput
} from '#lib/transformations/registry.ts';

export interface MimeRow {
	mimetype: string;
	transformation: string;
	transformation_options: string;
	input_transformation: string;
	input_transformation_options: string;
}

export const emptyMime = (): MimeRow => ({
	mimetype: '',
	transformation: '',
	transformation_options: '',
	input_transformation: '',
	input_transformation_options: ''
});

/** Column name -> settings. */
export type MimeMap = Map<string, MimeRow>;

function table(locals: App.Locals): string | null {
	const { server, config } = locals;
	if (!config.BrowseMIME || !server.pmadb || !server.column_info) return null;
	return escapeQualified(server.pmadb, server.column_info);
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

/**
 * Settings of the columns of one table that have any; an empty map when the storage is usable but
 * nothing is set; null when the feature is unavailable.
 */
export async function loadMime(
	locals: App.Locals,
	db: string,
	tableName: string
): Promise<MimeMap | null> {
	const qualified = table(locals);
	if (!qualified) return null;
	const rows = await withControl(locals, async (conn) => {
		const [res] = await conn.query(
			'SELECT `column_name`, `mimetype`, `transformation`, `transformation_options`, ' +
				'`input_transformation`, `input_transformation_options` FROM ' +
				qualified +
				" WHERE `db_name` = ? AND `table_name` = ? AND (`mimetype` != '' OR `transformation` != '' " +
				"OR `transformation_options` != '' OR `input_transformation` != '' " +
				"OR `input_transformation_options` != '')",
			[db, tableName]
		);
		return res as Record<string, unknown>[];
	});
	if (!rows) return null;
	const map: MimeMap = new Map();
	for (const r of rows) {
		map.set(str(r.column_name), {
			mimetype: str(r.mimetype),
			transformation: str(r.transformation),
			transformation_options: str(r.transformation_options),
			input_transformation: str(r.input_transformation),
			input_transformation_options: str(r.input_transformation_options)
		});
	}
	return map;
}

export const mimeEntrySchema = z.object({
	column: z.string().min(1).max(64),
	/** Previous name when the column is renamed in the same save. */
	oldName: z.string().max(64).optional(),
	mimetype: z.string().max(255).default(''),
	transformation: z.string().max(255).default(''),
	transformation_options: z.string().max(255).default(''),
	input_transformation: z.string().max(255).default(''),
	input_transformation_options: z.string().max(255).default('')
});
export type MimeEntry = z.infer<typeof mimeEntrySchema>;

/** Only known media types and plugins are stored, in phpMyAdmin's canonical spelling. */
export function sanitizeMime(entry: MimeEntry): MimeRow {
	const known = mimeTypes().map(mimeValue);
	const mime = mimeValue(entry.mimetype.trim());
	const out = resolveOutput(entry.transformation);
	const inp = resolveInput(entry.input_transformation);
	return {
		mimetype: known.includes(mime) ? mime : '',
		transformation: out ? outputKey(out) : '',
		transformation_options: out ? entry.transformation_options : '',
		input_transformation: inp ? inputKey(inp) : '',
		input_transformation_options: inp ? entry.input_transformation_options : ''
	};
}

/**
 * Transformations::setMime for several columns: update when a row exists (delete it when it has
 * nothing left to say), insert when there is something to store.
 */
export async function saveMime(
	locals: App.Locals,
	db: string,
	tableName: string,
	entries: MimeEntry[]
): Promise<boolean> {
	const qualified = table(locals);
	if (!qualified) return false;
	const done = await withControl(locals, async (conn) => {
		for (const entry of entries) {
			const row = sanitizeMime(entry);
			if (entry.oldName && entry.oldName !== entry.column) {
				await conn.query(
					`UPDATE ${qualified} SET \`column_name\` = ? WHERE \`db_name\` = ? AND \`table_name\` = ? AND \`column_name\` = ?`,
					[entry.column, db, tableName, entry.oldName]
				);
			}
			const hasValue = Object.values(row).some((v) => v.length > 0);
			const [found] = await conn.query(
				`SELECT \`comment\` FROM ${qualified} WHERE \`db_name\` = ? AND \`table_name\` = ? AND \`column_name\` = ?`,
				[db, tableName, entry.column]
			);
			const existing = (found as Record<string, unknown>[])[0];
			const key = [db, tableName, entry.column];
			if (existing) {
				if (hasValue || str(existing.comment).length > 0) {
					await conn.query(
						`UPDATE ${qualified} SET \`mimetype\` = ?, \`transformation\` = ?, \`transformation_options\` = ?, ` +
							'`input_transformation` = ?, `input_transformation_options` = ? ' +
							'WHERE `db_name` = ? AND `table_name` = ? AND `column_name` = ?',
						[
							row.mimetype,
							row.transformation,
							row.transformation_options,
							row.input_transformation,
							row.input_transformation_options,
							...key
						]
					);
				} else {
					await conn.query(
						`DELETE FROM ${qualified} WHERE \`db_name\` = ? AND \`table_name\` = ? AND \`column_name\` = ?`,
						key
					);
				}
			} else if (hasValue) {
				await conn.query(
					`INSERT INTO ${qualified} (\`db_name\`, \`table_name\`, \`column_name\`, \`mimetype\`, \`transformation\`, ` +
						'`transformation_options`, `input_transformation`, `input_transformation_options`) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
					[
						...key,
						row.mimetype,
						row.transformation,
						row.transformation_options,
						row.input_transformation,
						row.input_transformation_options
					]
				);
			}
		}
		return true;
	});
	return done === true;
}
