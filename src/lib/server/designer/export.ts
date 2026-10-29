/** Schema export of a Designer page (Plugins/Schema/*): PDF or SVG with the saved coordinates. */
import { z } from 'zod';
import { autoLayout } from '#lib/designer/auto.ts';
import {
	PAPER_SIZES,
	buildExportModel,
	renderSvg,
	type SchemaExportOptions
} from '#lib/designer/export.ts';
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import type { RelationServer } from '#lib/server/table/relation.ts';
import type { Connection } from 'mysql2/promise';
import { renderPdf } from './export-pdf.ts';
import { loadDesignerSchema } from './schema.ts';
import { loadPositions, type DesignerTables } from './storage.ts';

const flag = z
	.enum(['0', '1', 'on', 'off', 'true', 'false'])
	.optional()
	.transform((v) => v === '1' || v === 'on' || v === 'true');

export const exportQuerySchema = z.object({
	format: z.enum(['pdf', 'svg']).default('pdf'),
	page: z.coerce.number().int().min(0).default(0),
	show_color: flag,
	show_keys: flag,
	show_grid: flag,
	show_table_dimension: flag,
	all_tables_same_width: flag,
	with_doc: flag,
	orientation: z.enum(['L', 'P']).default('L'),
	paper: z.enum(PAPER_SIZES).default('A4'),
	table_order: z.enum(['', 'name_asc', 'name_desc']).default('')
});

export type ExportQuery = z.infer<typeof exportQuerySchema>;

export function toOptions(q: ExportQuery): SchemaExportOptions {
	return {
		showColor: q.show_color,
		showKeys: q.show_keys,
		showGrid: q.show_grid,
		showDimension: q.show_table_dimension,
		sameWidth: q.all_tables_same_width,
		orientation: q.orientation,
		paper: q.paper,
		withDoc: q.with_doc,
		tableOrder: q.table_order
	};
}

export interface SchemaFile {
	body: Buffer | string;
	mimeType: string;
	extension: string;
}

/** `storage` = the pages tables with a control connection, null when not configured. */
export async function exportSchema(
	dbi: DatabaseInterface,
	server: RelationServer,
	db: string,
	q: ExportQuery,
	storage: { conn: Connection; tables: DesignerTables } | null,
	appVersion = ''
): Promise<SchemaFile> {
	const schema = await loadDesignerSchema(dbi, server, db);
	const positions =
		storage && q.page > 0
			? await loadPositions(storage.conn, storage.tables, db, q.page)
			: autoLayout(schema.tables, schema.relations);
	const model = buildExportModel(db, schema.tables, schema.relations, positions, toOptions(q));
	if (q.format === 'svg') {
		return { body: renderSvg(model), mimeType: 'image/svg+xml', extension: 'svg' };
	}
	return {
		body: await renderPdf(model, appVersion),
		mimeType: 'application/pdf',
		extension: 'pdf'
	};
}
