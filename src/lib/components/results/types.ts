import type { ColumnKind } from '#lib/table/column-kind.ts';
import type { Cell } from './format.ts';

/** Column metadata the grid renders (independent of where the rows come from). */
export interface GridColumn {
	name: string;
	/** Full SQL type, shown as a tooltip (`varchar(255)`). */
	type?: string;
	kind: ColumnKind;
	/** `PRI` / `UNI` / `MUL`. */
	key?: string;
	comment?: string;
	nullable?: boolean;
	/** `enum` / `set` choices. */
	enumValues?: string[];
	/** May the cell be edited in place? */
	editable?: boolean;
	/** Header click sorts (default true). */
	sortable?: boolean;
}

export interface CellLink {
	href: string;
	title?: string | null;
}

export type EditResult = { ok: true; cell: Cell } | { ok: false; error: string };
