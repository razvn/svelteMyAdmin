/**
 * Storage engines (phpMyAdmin Controllers/Server/EnginesController.php, ShowEngineController.php,
 * StorageEngine.php and Engines/Innodb.php).
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';

export interface EngineRow {
	name: string;
	/** `DEFAULT`, `YES`, `NO` or `DISABLED`. */
	support: string;
	comment: string;
	transactions: string;
	xa: string;
	savepoints: string;
}

export interface EngineVariable {
	name: string;
	value: string;
}

/** Variable name prefixes shown on an engine's detail page (lower-case engine names). */
const ENGINE_VARIABLE_PREFIXES: Record<string, readonly string[]> = {
	innodb: ['innodb_'],
	myisam: ['myisam_', 'key_'],
	aria: ['aria_']
};

export function variablePrefixesFor(engine: string): readonly string[] {
	return ENGINE_VARIABLE_PREFIXES[engine.toLowerCase()] ?? [];
}

/** `LIKE` pattern matching names that start with `prefix` (`_` and `%` are escaped). */
export function prefixLikePattern(prefix: string): string {
	return prefix.replace(/[\\%_]/g, (c) => '\\' + c) + '%';
}

export function hasInnodbStatus(engine: string): boolean {
	return engine.toLowerCase() === 'innodb';
}

export async function listEngines(conn: Connection): Promise<EngineRow[]> {
	const [rows] = await conn.query<RowDataPacket[]>('SHOW ENGINES');
	return rows.map((r) => ({
		name: String(r.Engine),
		support: String(r.Support ?? ''),
		comment: String(r.Comment ?? ''),
		transactions: String(r.Transactions ?? ''),
		xa: String(r.XA ?? ''),
		savepoints: String(r.Savepoints ?? '')
	}));
}

/** Engine by name (case-insensitive, the name as the server spells it), or null. */
export async function findEngine(conn: Connection, name: string): Promise<EngineRow | null> {
	const wanted = name.toLowerCase();
	return (await listEngines(conn)).find((e) => e.name.toLowerCase() === wanted) ?? null;
}

/** Global variables of the engine's known prefixes, sorted by name. */
export async function listEngineVariables(
	conn: Connection,
	engine: string
): Promise<EngineVariable[]> {
	const found = new Map<string, string>();
	for (const prefix of variablePrefixesFor(engine)) {
		const [rows] = await conn.query<RowDataPacket[]>('SHOW GLOBAL VARIABLES LIKE ?', [
			prefixLikePattern(prefix)
		]);
		for (const r of rows) found.set(String(r.Variable_name), String(r.Value ?? ''));
	}
	return [...found]
		.map(([name, value]) => ({ name, value }))
		.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** `SHOW ENGINE INNODB STATUS` text. */
export async function getInnodbStatus(conn: Connection): Promise<string> {
	const [rows] = await conn.query<RowDataPacket[]>('SHOW ENGINE INNODB STATUS');
	return String(rows[0]?.Status ?? '');
}
