/** Central list of columns in `pma__central_columns` (libraries/classes/Database/CentralColumns.php). */
import type { Connection } from 'mysql2/promise';
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';
import { fromShowColumn } from '#lib/sql/central-columns.ts';
import { addCentral } from '#lib/server/storage/mysql/central-columns.ts';
import type { AddResult, CentralColumnsRepo } from '#lib/server/storage/types.ts';

export type { AddResult, CentralListOptions } from '#lib/server/storage/types.ts';
export {
	addCentral,
	countCentral,
	deleteCentral,
	listCentral,
	updateCentral
} from '#lib/server/storage/mysql/central-columns.ts';

/** The columns of `table` that are listed in `names`, as central column definitions. */
async function pickColumns(dbi: DatabaseInterface, db: string, table: string, names: string[]) {
	const all = await dbi.getColumns(db, table);
	return all.filter((c) => names.includes(c.field)).map(fromShowColumn);
}

/** CentralColumns::syncUniqueColumns for columns of one table (any repository). */
export async function addColumnsOfTable(
	repo: CentralColumnsRepo,
	dbi: DatabaseInterface,
	db: string,
	table: string,
	names: string[]
): Promise<AddResult> {
	return repo.add(db, await pickColumns(dbi, db, table, names));
}

/** Same on a MySQL connection and qualified table. */
export async function addTableColumns(
	conn: Connection,
	q: string,
	dbi: DatabaseInterface,
	db: string,
	table: string,
	names: string[]
): Promise<AddResult> {
	return addCentral(conn, q, db, await pickColumns(dbi, db, table, names));
}
