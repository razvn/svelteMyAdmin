/**
 * Character sets and collations (phpMyAdmin Controllers/Server/CollationsController.php, Charsets.php).
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';

export interface CharsetRow {
	name: string;
	description: string;
	defaultCollation: string;
}

export interface CollationRow {
	name: string;
	charset: string;
	isDefault: boolean;
}

export interface CollationEntry {
	name: string;
	/** Default collation of its character set (`IS_DEFAULT = 'Yes'`). */
	isDefault: boolean;
	/** The server-wide default (`@@collation_server`). */
	isServerDefault: boolean;
}

export interface CharsetGroup {
	name: string;
	description: string;
	defaultCollation: string;
	collations: CollationEntry[];
}

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Group collations under their character set. Charsets without rows are kept; collations whose
 * charset is missing from `charsets` get their own group with an empty description.
 */
export function groupCollations(
	charsets: CharsetRow[],
	collations: CollationRow[],
	serverCollation: string
): CharsetGroup[] {
	const groups = new Map<string, CharsetGroup>();
	for (const cs of charsets) {
		groups.set(cs.name, {
			name: cs.name,
			description: cs.description,
			defaultCollation: cs.defaultCollation,
			collations: []
		});
	}
	for (const coll of collations) {
		let group = groups.get(coll.charset);
		if (!group) {
			group = { name: coll.charset, description: '', defaultCollation: '', collations: [] };
			groups.set(coll.charset, group);
		}
		// MariaDB leaves IS_DEFAULT empty and only names the default in CHARACTER_SETS.DEFAULT_COLLATE_NAME.
		group.collations.push({
			name: coll.name,
			isDefault: coll.isDefault || coll.name === group.defaultCollation,
			isServerDefault: coll.name === serverCollation
		});
	}
	return [...groups.values()]
		.map((g) => ({ ...g, collations: g.collations.sort((a, b) => byName(a.name, b.name)) }))
		.sort((a, b) => byName(a.name, b.name));
}

export async function listCharsetGroups(conn: Connection): Promise<CharsetGroup[]> {
	const [charsetRows] = await conn.query<RowDataPacket[]>(
		'SELECT CHARACTER_SET_NAME AS name, DESCRIPTION AS description, ' +
			'DEFAULT_COLLATE_NAME AS default_collation FROM information_schema.CHARACTER_SETS ' +
			'ORDER BY CHARACTER_SET_NAME'
	);
	const [collationRows] = await conn.query<RowDataPacket[]>(
		'SELECT COLLATION_NAME AS name, CHARACTER_SET_NAME AS charset, IS_DEFAULT AS is_default ' +
			'FROM information_schema.COLLATIONS ORDER BY COLLATION_NAME'
	);
	const [[serverRow]] = await conn.query<RowDataPacket[]>(
		'SELECT @@collation_server AS collation_server'
	);
	return groupCollations(
		charsetRows.map((r) => ({
			name: String(r.name),
			description: String(r.description ?? ''),
			defaultCollation: String(r.default_collation ?? '')
		})),
		collationRows.map((r) => ({
			name: String(r.name),
			charset: String(r.charset),
			isDefault: String(r.is_default) === 'Yes'
		})),
		String(serverRow?.collation_server ?? '')
	);
}
