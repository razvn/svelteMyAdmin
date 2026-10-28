/**
 * Children of a database in the navigation tree (Navigation/Nodes/NodeDatabase*.php).
 * Names only: the tree needs them for links, counts and filtering.
 */
import type { DatabaseInterface } from '../db/dbi';
import type { NavConfig } from '#lib/nav/config.ts';
import type { DbChildren } from '#lib/nav/types.ts';

export type { DbChildren };

type Show = Pick<
	NavConfig,
	'showTables' | 'showViews' | 'showFunctions' | 'showProcedures' | 'showEvents'
>;

const ALL: Show = {
	showTables: true,
	showViews: true,
	showFunctions: true,
	showProcedures: true,
	showEvents: true
};

export async function getDbChildren(
	dbi: Pick<DatabaseInterface, 'listTables' | 'listRoutines' | 'listEvents'>,
	db: string,
	show: Show = ALL
): Promise<DbChildren> {
	const wantTables = show.showTables || show.showViews;
	const wantRoutines = show.showFunctions || show.showProcedures;
	const [tables, routines, events] = await Promise.all([
		wantTables ? dbi.listTables(db) : [],
		wantRoutines ? dbi.listRoutines(db) : [],
		show.showEvents ? dbi.listEvents(db).catch(() => []) : []
	]);
	const isView = (type: string) => type === 'VIEW' || type === 'SYSTEM VIEW';
	return {
		db,
		tables: show.showTables ? tables.filter((t) => !isView(t.type)).map((t) => t.name) : [],
		views: show.showViews ? tables.filter((t) => isView(t.type)).map((t) => t.name) : [],
		procedures: show.showProcedures
			? routines.filter((r) => r.type === 'PROCEDURE').map((r) => r.name)
			: [],
		functions: show.showFunctions
			? routines.filter((r) => r.type === 'FUNCTION').map((r) => r.name)
			: [],
		events: events.map((e) => e.name)
	};
}
