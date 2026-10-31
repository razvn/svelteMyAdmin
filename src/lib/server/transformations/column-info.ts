/**
 * Column transformation settings in `pma__column_info` (Transformations::getMime / setMime).
 * Everything degrades to "feature off" (null / false) when BrowseMIME is disabled or the
 * configuration storage is missing or unreachable.
 */
import { z } from 'zod';
import { hasRepo, withRepo } from '#lib/server/storage/index.ts';
import type { MimeRow } from '#lib/server/storage/types.ts';
import {
	inputKey,
	mimeTypes,
	mimeValue,
	outputKey,
	resolveInput,
	resolveOutput
} from '#lib/transformations/registry.ts';

export type { MimeRow };

export const emptyMime = (): MimeRow => ({
	mimetype: '',
	transformation: '',
	transformation_options: '',
	input_transformation: '',
	input_transformation_options: ''
});

/** Column name -> settings. */
export type MimeMap = Map<string, MimeRow>;

/** BrowseMIME is on and the column information storage is available. */
function available(locals: App.Locals): boolean {
	return locals.config.BrowseMIME && hasRepo(locals.server, 'columnInfo');
}

/**
 * Settings of the columns of one table that have any; an empty map when the storage is usable but
 * nothing is set; null when the feature is unavailable.
 */
export async function loadMime(
	locals: App.Locals,
	db: string,
	tableName: string
): Promise<MimeMap | null> {
	if (!available(locals)) return null;
	const rows = await withRepo(locals, 'columnInfo', (repo) => repo.loadMime(db, tableName));
	if (!rows) return null;
	const map: MimeMap = new Map();
	for (const { column, ...row } of rows) map.set(column, row);
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
	if (!available(locals)) return false;
	const done = await withRepo(locals, 'columnInfo', async (repo) => {
		await repo.saveMime(
			db,
			tableName,
			entries.map((e) => ({ column: e.column, oldName: e.oldName, row: sanitizeMime(e) }))
		);
		return true;
	});
	return done === true;
}
