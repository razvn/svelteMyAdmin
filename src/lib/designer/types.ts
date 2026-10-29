/** Shared (client + server) model of the Designer: tables, relations and positions. */

export interface DesignerColumn {
	name: string;
	type: string;
	nullable: boolean;
	default: string | null;
	/** PRIMARY KEY column. */
	primary: boolean;
	/** Part of a UNIQUE key. */
	unique: boolean;
	/** Part of any other index (MUL). */
	indexed: boolean;
	/** Source of a foreign key or internal relation. */
	foreign: boolean;
}

export interface DesignerTable {
	name: string;
	engine: string | null;
	columns: DesignerColumn[];
	/** `pma__table_info.display_field` ('' = none). */
	displayField: string;
}

export interface DesignerRelation {
	/** Stable id: `fk:<table>:<constraint>:<n>` or `internal:<table>:<column>`. */
	id: string;
	kind: 'fk' | 'internal';
	fromTable: string;
	fromColumn: string;
	toTable: string;
	toColumn: string;
	/** Constraint name (kind 'fk'). */
	constraint?: string;
	onDelete?: string;
	onUpdate?: string;
}

export interface Position {
	x: number;
	y: number;
}

export type Positions = Record<string, Position>;

export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface DesignerPage {
	id: number;
	name: string;
}

/** Display options that change the size of a table card. */
export interface CardView {
	/** Only the header is shown. */
	collapsed: boolean;
	/** Only PRIMARY / UNIQUE / indexed / foreign columns are listed. */
	keysOnly: boolean;
}
