/**
 * Repository interfaces of the configuration storage (the `pma__*` tables). Every feature talks to
 * one of these; a MySQL implementation (phpMyAdmin compatible pmadb) and a SQLite implementation
 * (opt-in `ConfigStorage`) provide them. Methods reject when the storage cannot be reached; callers
 * decide how to fall back (see `attempt` in `./index.ts`).
 */
import type { HiddenItem } from '#lib/nav/hidden.ts';
import type { TableRef } from '#lib/nav/recent.ts';
import type { PrefData } from '#lib/preferences/logic.ts';
import type { DesignerPage, Positions } from '#lib/designer/types.ts';
import type { CentralColumn } from '#lib/sql/central-columns.ts';
import type { HistoryEntry } from '#lib/sql/history.ts';

export type { HiddenItem, TableRef, HistoryEntry };

/** Every repository can tell whether its table answers (MySQL: `SELECT 1 ... LIMIT 1`). */
export interface Pingable {
	ping(): Promise<boolean>;
}

// ---- bookmarks ---------------------------------------------------------------------------------

export interface Bookmark {
	id: number;
	db: string;
	label: string;
	query: string;
	/** Visible to every user. */
	shared: boolean;
}

export interface NewBookmark {
	db: string;
	label: string;
	query: string;
	shared: boolean;
	/** Delete the visible bookmarks of the same label first (Sql::storeTheQueryAsBookmark). */
	replace: boolean;
}

export interface BookmarkRepo extends Pingable {
	/** Own and shared bookmarks of `db` ('' = server level), by label. */
	list(user: string, db: string): Promise<Bookmark[]>;
	/** One bookmark visible to `user` (own or shared). */
	get(user: string, db: string, id: number): Promise<Bookmark | null>;
	insert(user: string, b: NewBookmark): Promise<number>;
	delete(user: string, id: number): Promise<boolean>;
}

// ---- history -----------------------------------------------------------------------------------

export interface HistoryRepo extends Pingable {
	insert(row: { username: string; db: string; table: string; sqlquery: string }): Promise<void>;
	/** Keep the newest `max` rows of `username` (by id); returns the number of deleted rows. */
	purge(username: string, max: number): Promise<number>;
	/** Newest first. */
	select(username: string, limit: number): Promise<HistoryEntry[]>;
	clear(username: string): Promise<void>;
}

// ---- recent / favorite -------------------------------------------------------------------------

export interface RecentFavoriteRepo extends Pingable {
	select(user: string): Promise<TableRef[]>;
	replace(user: string, list: readonly TableRef[]): Promise<void>;
}

// ---- user preferences --------------------------------------------------------------------------

export interface StoredPrefs {
	data: PrefData;
	/** Unix seconds of the last save. */
	mtime: number;
}

export interface UserConfigRepo extends Pingable {
	load(username: string): Promise<StoredPrefs | null>;
	save(username: string, data: PrefData): Promise<void>;
	delete(username: string): Promise<void>;
}

// ---- navigation hiding -------------------------------------------------------------------------

export interface NavigationHidingRepo extends Pingable {
	list(user: string, db: string): Promise<HiddenItem[]>;
	hide(user: string, db: string, item: HiddenItem): Promise<void>;
	unhide(user: string, db: string, item: HiddenItem): Promise<void>;
}

// ---- user groups (pma__users + pma__usergroups) ------------------------------------------------

export interface UserGroup {
	name: string;
	/** tab key -> allowed */
	tabs: Record<string, boolean>;
}

export interface UserGroupsRepo extends Pingable {
	/** All groups with their tab rows, ordered by name. */
	listGroups(): Promise<UserGroup[]>;
	getGroup(name: string): Promise<UserGroup | null>;
	/** Replace the rows of the group: one allowed row per tab key in `allTabKeys` (UserGroups::edit). */
	saveGroup(
		name: string,
		allowedKeys: readonly string[],
		allTabKeys: readonly string[]
	): Promise<void>;
	groupExists(name: string): Promise<boolean>;
	/** Remove the group and its memberships (UserGroups::delete). */
	deleteGroup(name: string): Promise<void>;
	listGroupUsers(name: string): Promise<string[]>;
	/** username -> group name. */
	listMemberships(): Promise<Record<string, string>>;
	/** Assign a user to a group (or none): a user belongs to at most one group. */
	setUserGroup(username: string, group: string | null): Promise<void>;
	/** Raw tab keys the user's group forbids (`allowed = 'N'`). */
	deniedTabKeys(username: string): Promise<string[]>;
}

// ---- central columns ---------------------------------------------------------------------------

export interface CentralListOptions {
	pos?: number;
	/** 0 = no limit. */
	num?: number;
	/** Substring of the column name. */
	filter?: string;
}

export interface AddResult {
	added: string[];
	/** Already in the list: left untouched (phpMyAdmin asks to remove them first). */
	existing: string[];
}

export interface CentralColumnsRepo extends Pingable {
	list(db: string, o?: CentralListOptions): Promise<CentralColumn[]>;
	count(db: string, filter?: string): Promise<number>;
	add(db: string, columns: CentralColumn[]): Promise<AddResult>;
	update(db: string, original: string, c: CentralColumn): Promise<void>;
	/** Returns the names that were not in the list. */
	delete(db: string, names: string[]): Promise<string[]>;
}

// ---- tracking ----------------------------------------------------------------------------------

export interface TrackingVersionRow {
	db: string;
	table: string;
	version: number;
	created: string;
	updated: string;
	tracking: string;
	active: boolean;
}

export interface TrackingRawRow {
	tracking: string;
	schema_snapshot: string | null;
	schema_sql: string | null;
	data_sql: string | null;
}

export interface NewTrackingVersion {
	db: string;
	table: string;
	version: number;
	created: string;
	updated: string;
	snapshot: string;
	schemaSql: string;
	dataSql: string;
	tracking: string;
}

export interface TrackingRepo extends Pingable {
	anyActive(db: string): Promise<boolean>;
	/** Highest version (optionally of the versions tracking `statement`); -1 when none. */
	maxVersion(db: string, table: string, statement?: string): Promise<number>;
	/** Is the newest version of the table active? */
	isActive(db: string, table: string): Promise<boolean>;
	insert(v: NewTrackingVersion): Promise<void>;
	setActive(db: string, table: string, version: number, active: boolean): Promise<void>;
	delete(db: string, table: string, version?: number): Promise<void>;
	/** Versions of one table, newest first. */
	listVersions(db: string, table: string): Promise<TrackingVersionRow[]>;
	/** Newest version of every tracked table of a database. */
	listTracked(db: string): Promise<TrackingVersionRow[]>;
	get(db: string, table: string, version: number): Promise<TrackingRawRow | null>;
	/** Replace one log. */
	saveLog(
		db: string,
		table: string,
		version: number,
		which: 'ddl' | 'dml',
		text: string
	): Promise<void>;
	/** Append a chunk to a log of the version tracking `statement` (Tracker::handleQuery). */
	appendLog(o: {
		db: string;
		table: string;
		version: number;
		which: 'ddl' | 'dml';
		chunk: string;
		updated: string;
		statement: string;
		renameTo?: string;
	}): Promise<void>;
}

// ---- designer ----------------------------------------------------------------------------------

/** `pma__pdf_pages` + `pma__table_coords`. */
export interface DesignerPagesRepo extends Pingable {
	listPages(db: string): Promise<DesignerPage[]>;
	pageExists(db: string, id: number): Promise<boolean>;
	createPage(db: string, name: string): Promise<number>;
	renamePage(db: string, id: number, name: string): Promise<void>;
	/** Delete a page and its coordinates (Common::deletePage). */
	deletePage(db: string, id: number): Promise<void>;
	loadPositions(db: string, id: number): Promise<Positions>;
	/** Replace the coordinates of a page. */
	savePositions(db: string, id: number, positions: Positions): Promise<void>;
}

export interface DesignerSettingsRepo extends Pingable {
	/** The stored JSON text, null when the user has no row. */
	get(username: string): Promise<string | null>;
	set(username: string, json: string): Promise<void>;
}

// ---- relations, display fields, column info ----------------------------------------------------

export interface InternalRelation {
	column: string;
	refDb: string;
	refTable: string;
	refColumn: string;
}

export interface RelationRow extends InternalRelation {
	masterTable: string;
}

export interface RelationRepo extends Pingable {
	/** Internal relations of one table, by column. */
	listForTable(db: string, table: string): Promise<InternalRelation[]>;
	/** Internal relations whose master table is in `db`. */
	listForDb(db: string): Promise<RelationRow[]>;
	/**
	 * Set (or, with `ref` null, remove) the relation of one column. Returns the statements run (for
	 * display).
	 */
	set(
		db: string,
		table: string,
		column: string,
		ref: { db: string; table: string; column: string } | null
	): Promise<string[]>;
	/** Carry the relations of a table over to a renamed / copied table; returns the statements run. */
	transferTable(
		from: { db: string; table: string },
		to: { db: string; table: string },
		move: boolean
	): Promise<string[]>;
}

export interface TableInfoRepo extends Pingable {
	/** The display field of a table ('' = none). */
	get(db: string, table: string): Promise<string>;
	/** table name -> display field, for a database. */
	listForDb(db: string): Promise<{ table: string; displayField: string }[]>;
	/** Set (empty = remove) the display field. */
	set(db: string, table: string, column: string): Promise<void>;
	transferTable(
		from: { db: string; table: string },
		to: { db: string; table: string },
		move: boolean
	): Promise<string[]>;
}

export interface MimeRow {
	mimetype: string;
	transformation: string;
	transformation_options: string;
	input_transformation: string;
	input_transformation_options: string;
}

export interface ColumnInfoRow {
	table: string;
	column: string;
	comment: string;
	mimetype: string;
}

export interface MimeSave {
	column: string;
	/** Previous name when the column is renamed in the same save. */
	oldName?: string;
	row: MimeRow;
}

export interface ColumnInfoRepo extends Pingable {
	/** Transformation settings of the columns of a table that have any, by column. */
	loadMime(db: string, table: string): Promise<(MimeRow & { column: string })[]>;
	/** Transformations::setMime for several columns. */
	saveMime(db: string, table: string, entries: MimeSave[]): Promise<void>;
	getDbComment(db: string): Promise<string>;
	/** Set (empty = remove) the comment of a database; returns the statement run. */
	setDbComment(db: string, comment: string): Promise<string[]>;
	/** Column comments + MIME types of the tables of a database (data dictionary). */
	listForDb(db: string): Promise<ColumnInfoRow[]>;
	/** Move (rename) or duplicate every row of a database; returns the statements run. */
	transferDb(oldDb: string, newDb: string, move: boolean): Promise<string[]>;
	transferTable(
		from: { db: string; table: string },
		to: { db: string; table: string },
		move: boolean
	): Promise<string[]>;
}

// ---- saved searches, ui prefs, export templates ------------------------------------------------

export interface SavedSearchRow {
	id: number;
	name: string;
	/** JSON text. */
	data: string;
}

export interface SavedSearchesRepo extends Pingable {
	list(user: string, db: string): Promise<SavedSearchRow[]>;
	/** Rejects when the name is already used. */
	insert(user: string, db: string, name: string, json: string): Promise<number>;
	/** Number of updated rows. */
	update(id: number, user: string, db: string, name: string, json: string): Promise<number>;
	/** Number of deleted rows. */
	delete(id: number, user: string, db: string): Promise<number>;
}

export interface TableUiPrefsRepo extends Pingable {
	/** The stored JSON text, null when none. */
	get(user: string, db: string, table: string): Promise<string | null>;
	set(user: string, db: string, table: string, json: string): Promise<void>;
}

export interface ExportTemplateRow {
	id: number;
	name: string;
}

export interface ExportTemplatesRepo extends Pingable {
	list(user: string, type: string): Promise<ExportTemplateRow[]>;
	/** The stored JSON text of one template of the user, null when missing. */
	get(id: number, user: string): Promise<string | null>;
	/** Rejects when the name is already used. */
	create(user: string, type: string, name: string, json: string): Promise<number>;
	update(id: number, user: string, json: string): Promise<boolean>;
	delete(id: number, user: string): Promise<boolean>;
}

// ---- the set -----------------------------------------------------------------------------------

/** The repositories of one server; a feature is `null` when it is not configured. */
export interface Repos {
	kind: 'mysql' | 'sqlite';
	bookmarks: BookmarkRepo | null;
	history: HistoryRepo | null;
	recent: RecentFavoriteRepo | null;
	favorite: RecentFavoriteRepo | null;
	userConfig: UserConfigRepo | null;
	navigationHiding: NavigationHidingRepo | null;
	userGroups: UserGroupsRepo | null;
	centralColumns: CentralColumnsRepo | null;
	tracking: TrackingRepo | null;
	designerPages: DesignerPagesRepo | null;
	designerSettings: DesignerSettingsRepo | null;
	relation: RelationRepo | null;
	tableInfo: TableInfoRepo | null;
	columnInfo: ColumnInfoRepo | null;
	savedSearches: SavedSearchesRepo | null;
	tableUiPrefs: TableUiPrefsRepo | null;
	exportTemplates: ExportTemplatesRepo | null;
}

export type RepoKey = Exclude<keyof Repos, 'kind'>;
