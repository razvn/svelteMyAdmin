/**
 * Plain, serialisable description of a database used by the Query pages (QBE and multi-table
 * query): tables with their columns, foreign keys, internal relations (`pma__relation`) and indexes.
 * Loaded once on the server and consumed by the pure SQL builders in the browser.
 */

export interface QuerySchemaTable {
	name: string;
	columns: string[];
	/** Estimated row count (information_schema), used to pick the largest table as join master. */
	rows: number;
}

export interface QuerySchemaForeignKey {
	/** Constraint name; rows with the same table + constraint form one composite key. */
	constraint: string;
	table: string;
	column: string;
	refTable: string;
	refColumn: string;
}

export interface QuerySchemaInternalRelation {
	table: string;
	field: string;
	refTable: string;
	refField: string;
}

export interface QuerySchemaIndex {
	table: string;
	column: string;
	nonUnique: boolean;
}

export interface QuerySchemaData {
	tables: QuerySchemaTable[];
	/** Foreign keys whose referenced table lives in the same database. */
	foreignKeys: QuerySchemaForeignKey[];
	internalRelations: QuerySchemaInternalRelation[];
	indexes: QuerySchemaIndex[];
}
