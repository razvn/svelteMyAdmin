/** Server side of the media type / transformation fields of the column editor. */
import { z } from 'zod';
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import { transformChoices, canonicalSettings, emptySettings } from '#lib/transformations/ui.ts';
import type { ColumnTransformSettings, TransformChoices } from '#lib/transformations/ui.ts';
import { loadMime, mimeEntrySchema, saveMime } from './column-info.ts';

export interface TransformUi {
	choices: TransformChoices;
	/** Current settings per column id (change mode); add mode starts empty. */
	byId: Record<number, ColumnTransformSettings>;
}

/** Fields data for the editor, or null when column_info storage is unavailable / BrowseMIME is off. */
export async function transformUi(
	locals: App.Locals,
	db: string,
	table: string,
	columns: { id: number; name: string }[]
): Promise<TransformUi | null> {
	const mime = await loadMime(locals, db, table);
	if (!mime) return null;
	const byId: Record<number, ColumnTransformSettings> = {};
	for (const c of columns) {
		const row = mime.get(c.name);
		byId[c.id] = row ? canonicalSettings(row) : emptySettings();
	}
	return { choices: transformChoices(locals.i18n.t), byId };
}

const payloadSchema = z.object({ transformations: z.array(mimeEntrySchema).max(4096).optional() });

/** Store the settings sent with an add / change columns payload (after the ALTER succeeded). */
export async function saveStructureTransforms(
	locals: App.Locals,
	dbi: DatabaseInterface,
	db: string,
	table: string,
	payload: unknown
): Promise<void> {
	const parsed = payloadSchema.safeParse(payload);
	const entries = parsed.success ? parsed.data.transformations : undefined;
	if (!entries?.length) return;
	const names = new Set((await dbi.getColumns(db, table)).map((c) => c.field));
	await saveMime(
		locals,
		db,
		table,
		entries.filter((e) => names.has(e.column))
	);
}
