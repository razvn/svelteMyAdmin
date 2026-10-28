/** Children of a database in the navigation tree (names only). */
export interface DbChildren {
	db: string;
	tables: string[];
	views: string[];
	procedures: string[];
	functions: string[];
	events: string[];
}
