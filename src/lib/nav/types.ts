/** Children of a database in the navigation tree (names only). */
export interface DbChildren {
	db: string;
	tables: string[];
	views: string[];
	procedures: string[];
	functions: string[];
	events: string[];
	/** The navigationhiding feature is available (the tree offers "Hide"). */
	canHide?: boolean;
	/** Number of hidden items of this database. */
	hiddenCount?: number;
}
