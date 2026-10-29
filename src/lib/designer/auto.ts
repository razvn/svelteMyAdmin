import { tableHeight, tableWidth } from './geometry.ts';
import { forceLayout } from './layout.ts';
import type { CardView, DesignerRelation, DesignerTable, Positions } from './types.ts';

const FULL: CardView = { collapsed: false, keysOnly: false };

/** Automatic positions of `tables`: related tables are pulled together, the rest is deterministic. */
export function autoLayout(
	tables: DesignerTable[],
	relations: DesignerRelation[],
	view: CardView = FULL
): Positions {
	const names = new Set(tables.map((t) => t.name));
	return forceLayout(
		tables.map((t) => ({ name: t.name, w: tableWidth(t), h: tableHeight(t, view) })),
		relations
			.filter((r) => names.has(r.fromTable) && names.has(r.toTable))
			.map((r) => ({ from: r.fromTable, to: r.toTable }))
	);
}
