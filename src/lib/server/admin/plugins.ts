/**
 * Server plugins (phpMyAdmin Controllers/Server/PluginsController.php, Server/Plugins.php).
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';

export interface PluginRow {
	name: string;
	version: string;
	status: string;
	type: string;
	author: string;
	description: string;
	license: string;
}

export interface PluginGroup {
	type: string;
	/** Anchor id of the group (`plugins-<letters>`), as in phpMyAdmin's `clean_types`. */
	anchor: string;
	plugins: PluginRow[];
}

/** `preg_replace('/[^a-z]/', '', mb_strtolower($type))` prefixed with `plugins-`. */
export function pluginTypeAnchor(type: string): string {
	return 'plugins-' + type.toLowerCase().replace(/[^a-z]/g, '');
}

const byString = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Groups sorted by type (PHP `ksort`), plugins keep their input order within a group. */
export function groupPluginsByType(rows: PluginRow[]): PluginGroup[] {
	const groups = new Map<string, PluginRow[]>();
	for (const row of rows) {
		const list = groups.get(row.type) ?? [];
		list.push(row);
		groups.set(row.type, list);
	}
	return [...groups.keys()].sort(byString).map((type) => ({
		type,
		anchor: pluginTypeAnchor(type),
		plugins: groups.get(type)!
	}));
}

export async function listPlugins(conn: Connection): Promise<PluginRow[]> {
	const [rows] = await conn.query<RowDataPacket[]>(
		'SELECT PLUGIN_NAME AS name, PLUGIN_VERSION AS version, PLUGIN_STATUS AS status, ' +
			'PLUGIN_TYPE AS type, PLUGIN_AUTHOR AS author, PLUGIN_DESCRIPTION AS description, ' +
			'PLUGIN_LICENSE AS license FROM information_schema.PLUGINS ORDER BY PLUGIN_TYPE, PLUGIN_NAME'
	);
	return rows.map((r) => ({
		name: String(r.name ?? ''),
		version: String(r.version ?? ''),
		status: String(r.status ?? ''),
		type: String(r.type ?? ''),
		author: String(r.author ?? ''),
		description: String(r.description ?? ''),
		license: String(r.license ?? '')
	}));
}
