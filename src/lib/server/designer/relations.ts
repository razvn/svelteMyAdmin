/**
 * Relations made from the Designer (Designer/Common.php addNewRelation / removeRelation): an InnoDB
 * foreign key through the table relation code of the Relation view, or an internal relation in
 * `pma__relation`.
 */
import { z } from 'zod';
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import {
	dropForeignKey,
	saveDisplayField,
	saveForeignKey,
	saveInternalRelation,
	type RelationServer
} from '#lib/server/table/relation.ts';
import { FK_ACTIONS } from '#lib/sql/foreign-key.ts';
import type { ActionResult } from '#lib/server/table/structure.ts';

const ident = z.string().min(1).max(64);
const action = z.enum(FK_ACTIONS as unknown as [string, ...string[]]);

export const createRelationSchema = z.object({
	kind: z.enum(['fk', 'internal']),
	fromTable: ident,
	fromColumn: ident,
	toTable: ident,
	toColumn: ident,
	onDelete: action.default(''),
	onUpdate: action.default(''),
	name: z.string().max(64).default('')
});
export const deleteRelationSchema = z.object({
	kind: z.enum(['fk', 'internal']),
	table: ident,
	column: ident,
	constraint: z.string().max(64).default('')
});
export const displayFieldSchema = z.object({ table: ident, column: z.string().max(64) });

const bad: ActionResult = { ok: false, error: 'Invalid input.', sql: [] };

export async function createRelation(
	dbi: DatabaseInterface,
	server: RelationServer,
	db: string,
	raw: unknown
): Promise<ActionResult> {
	const p = createRelationSchema.safeParse(raw);
	if (!p.success) return bad;
	const r = p.data;
	if (r.kind === 'fk') {
		return saveForeignKey(
			{ dbi, db, table: r.fromTable },
			{
				original: null,
				def: {
					name: r.name,
					columns: [r.fromColumn],
					refDb: db,
					refTable: r.toTable,
					refColumns: [r.toColumn],
					onDelete: r.onDelete,
					onUpdate: r.onUpdate
				}
			}
		);
	}
	return saveInternalRelation({ dbi, db, table: r.fromTable }, server, {
		column: r.fromColumn,
		refDb: db,
		refTable: r.toTable,
		refColumn: r.toColumn
	});
}

export async function deleteRelation(
	dbi: DatabaseInterface,
	server: RelationServer,
	db: string,
	raw: unknown
): Promise<ActionResult> {
	const p = deleteRelationSchema.safeParse(raw);
	if (!p.success) return bad;
	const r = p.data;
	if (r.kind === 'fk') {
		if (!r.constraint) return bad;
		return dropForeignKey({ dbi, db, table: r.table }, { name: r.constraint });
	}
	return saveInternalRelation({ dbi, db, table: r.table }, server, {
		column: r.column,
		refDb: '',
		refTable: '',
		refColumn: ''
	});
}

export async function setDisplayField(
	dbi: DatabaseInterface,
	server: RelationServer,
	db: string,
	raw: unknown
): Promise<ActionResult> {
	const p = displayFieldSchema.safeParse(raw);
	if (!p.success) return bad;
	return saveDisplayField({ dbi, db, table: p.data.table }, server, { column: p.data.column });
}
