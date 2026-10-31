/**
 * Designer persistence in the configuration storage (Database/Designer/Common.php): pages in
 * `pma__pdf_pages`, table positions in `pma__table_coords`, per-user settings in
 * `pma__designer_settings`. The routes use the repositories (`designerPages`, `designerSettings`);
 * the connection based functions are the MySQL implementation, usable on any connection.
 */
import type { Connection } from 'mysql2/promise';
import {
	mergeSetting,
	parseSettings,
	type DesignerKey,
	type StoredSettings
} from '#lib/designer/settings.ts';
import { loadSettingsJson, storeSettingsJson } from '#lib/server/storage/mysql/designer.ts';
import type { DesignerSettingsRepo } from '#lib/server/storage/types.ts';

export {
	createPage,
	deletePage,
	listPages,
	loadPositions,
	loadSettingsJson,
	pageExists,
	renamePage,
	savePositions,
	type DesignerTables
} from '#lib/server/storage/mysql/designer.ts';

export async function loadSettings(
	conn: Connection,
	qualified: string,
	username: string
): Promise<StoredSettings> {
	return parseSettings(await loadSettingsJson(conn, qualified, username));
}

/** Set one setting, keeping the user's other keys (Common::saveSetting). */
export async function saveSetting(
	conn: Connection,
	qualified: string,
	username: string,
	key: DesignerKey,
	value: string
): Promise<void> {
	const current = await loadSettingsJson(conn, qualified, username);
	await storeSettingsJson(conn, qualified, username, mergeSetting(current, key, value));
}

/** Repository flavour of `loadSettings`. */
export async function loadDesignerSettings(
	repo: DesignerSettingsRepo,
	username: string
): Promise<StoredSettings> {
	return parseSettings(await repo.get(username));
}

/** Repository flavour of `saveSetting`. */
export async function saveDesignerSetting(
	repo: DesignerSettingsRepo,
	username: string,
	key: DesignerKey,
	value: string
): Promise<void> {
	await repo.set(username, mergeSetting(await repo.get(username), key, value));
}
