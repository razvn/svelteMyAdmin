/**
 * Configuration schema. Key names and defaults mirror phpMyAdmin's `$cfg`
 * (libraries/config.default.php). `Servers` is a 0-indexed array here
 * (1-indexed in PHP); `ServerDefault` stays 1-based like in phpMyAdmin.
 */
import { z } from 'zod';

/** PHP allows ports as strings ('' = default). Normalise to a number (0 = default). */
const port = z.preprocess(
	(v) => (v === '' || v === null || v === undefined ? 0 : typeof v === 'string' ? Number(v) : v),
	z.number().int().min(0).max(65535)
);

/** A table name key of the configuration storage (empty = not configured). */
const pmaTable = z.string().default('');

const nullableString = z.string().nullable().default(null);

export const allowDenySchema = z
	.object({
		order: z.enum(['', 'deny,allow', 'allow,deny', 'explicit']).default(''),
		rules: z.array(z.string()).default([])
	})
	.default({ order: '', rules: [] });

export const serverSchema = z
	.object({
		verbose: z.string().default(''),
		host: z.string().default('localhost'),
		port: port.default(0),
		socket: z.string().default(''),
		ssl: z.boolean().default(false),
		ssl_key: nullableString,
		ssl_cert: nullableString,
		ssl_ca: nullableString,
		ssl_ca_path: nullableString,
		ssl_ciphers: nullableString,
		ssl_verify: z.boolean().default(true),
		compress: z.boolean().default(false),
		controlhost: z.string().default(''),
		controlport: port.default(0),
		controluser: z.string().default(''),
		controlpass: z.string().default(''),
		auth_type: z.enum(['cookie', 'config', 'http', 'signon']).default('cookie'),
		auth_http_realm: z.string().default(''),
		user: z.string().default('root'),
		password: z.string().default(''),
		SignonSession: z.string().default(''),
		SignonCookieParams: z.record(z.string(), z.unknown()).default({}),
		SignonScript: z.string().default(''),
		SignonURL: z.string().default(''),
		LogoutURL: z.string().default(''),
		only_db: z.union([z.string(), z.array(z.string())]).default(''),
		hide_db: z.string().default(''),

		// Configuration storage
		pmadb: z.string().default(''),
		bookmarktable: pmaTable,
		relation: pmaTable,
		table_info: pmaTable,
		table_coords: pmaTable,
		pdf_pages: pmaTable,
		column_info: pmaTable,
		history: pmaTable,
		recent: pmaTable,
		favorite: pmaTable,
		table_uiprefs: pmaTable,
		tracking: pmaTable,
		userconfig: pmaTable,
		users: pmaTable,
		usergroups: pmaTable,
		navigationhiding: pmaTable,
		savedsearches: pmaTable,
		central_columns: pmaTable,
		designer_settings: pmaTable,
		export_templates: pmaTable,
		MaxTableUiprefs: z.number().int().default(100),

		SessionTimeZone: z.string().default(''),
		AllowRoot: z.boolean().default(true),
		AllowNoPassword: z.boolean().default(false),
		AllowDeny: allowDenySchema,
		DisableIS: z.boolean().default(false),
		tracking_version_auto_create: z.boolean().default(false),
		tracking_default_statements: z
			.string()
			.default(
				'CREATE TABLE,ALTER TABLE,DROP TABLE,RENAME TABLE,CREATE INDEX,' +
					'DROP INDEX,INSERT,UPDATE,DELETE,TRUNCATE,REPLACE,CREATE VIEW,' +
					'ALTER VIEW,DROP VIEW,CREATE DATABASE,ALTER DATABASE,DROP DATABASE'
			),
		tracking_add_drop_view: z.boolean().default(true),
		tracking_add_drop_table: z.boolean().default(true),
		tracking_add_drop_database: z.boolean().default(true),
		hide_connection_errors: z.boolean().default(false)
	})
	// Keep unknown phpMyAdmin keys instead of rejecting them.
	.loose();

export type ServerConfig = z.infer<typeof serverSchema>;
export type ServerConfigInput = z.input<typeof serverSchema>;

export const configSchema = z
	.object({
		blowfish_secret: z.string().default(''),
		PmaAbsoluteUri: z.string().default(''),
		AllowThirdPartyFraming: z.union([z.boolean(), z.literal('sameorigin')]).default(false),
		Servers: z.array(serverSchema).default([]),
		ServerDefault: z.number().int().min(0).default(1),

		MaxDbList: z.number().int().default(100),
		MaxTableList: z.number().int().default(250),
		ShowHint: z.boolean().default(true),
		MaxCharactersInDisplayedSQL: z.number().int().default(1000),
		ExecTimeLimit: z.number().int().default(300),
		ShowSQL: z.boolean().default(true),
		RetainQueryBox: z.boolean().default(false),
		/** Links shown with every executed query (config.default.php `SQLQuery`). */
		SQLQuery: z
			.object({
				Edit: z.boolean().default(true),
				Explain: z.boolean().default(true),
				ShowAsPHP: z.boolean().default(true),
				Refresh: z.boolean().default(true)
			})
			.default({ Edit: true, Explain: true, ShowAsPHP: true, Refresh: true }),
		CodemirrorEnable: z.boolean().default(true),
		LintEnable: z.boolean().default(true),
		AllowUserDropDatabase: z.boolean().default(false),
		Confirm: z.boolean().default(true),
		CookieSameSite: z.enum(['Lax', 'Strict', 'None']).default('Strict'),
		LoginCookieRecall: z.boolean().default(true),
		LoginCookieValidity: z.number().int().positive().default(1440),
		LoginCookieStore: z.number().int().min(0).default(0),
		LoginCookieDeleteAll: z.boolean().default(true),
		UseDbSearch: z.boolean().default(true),
		AllowArbitraryServer: z.boolean().default(false),
		ArbitraryServerRegexp: z.string().default(''),
		/** proxy IP => header carrying the client address (e.g. `X-Forwarded-For`). */
		TrustedProxies: z.record(z.string(), z.string()).default({}),

		// Navigation panel
		ShowDatabasesNavigationAsTree: z.boolean().default(true),
		FirstLevelNavigationItems: z.number().int().default(100),
		MaxNavigationItems: z.number().int().default(50),
		NavigationTreeEnableGrouping: z.boolean().default(true),
		NavigationTreeDbSeparator: z.string().default('_'),
		NavigationTreeTableSeparator: z.union([z.string(), z.array(z.string())]).default('__'),
		NavigationTreeTableLevel: z.number().int().min(1).default(1),
		NavigationLinkWithMainPanel: z.boolean().default(true),
		NavigationDisplayLogo: z.boolean().default(true),
		NumRecentTables: z.number().int().default(10),
		NumFavoriteTables: z.number().int().default(10),
		NavigationTreeDisplayItemFilterMinimum: z.number().int().default(30),
		NavigationDisplayServers: z.boolean().default(true),
		DisplayServersList: z.boolean().default(false),
		NavigationTreeDisplayDbFilterMinimum: z.number().int().default(30),
		NavigationTreeDefaultTabTable: z
			.enum(['structure', 'sql', 'search', 'insert', 'browse'])
			.default('structure'),
		NavigationTreeEnableExpansion: z.boolean().default(true),
		NavigationTreeShowTables: z.boolean().default(true),
		NavigationTreeShowViews: z.boolean().default(true),
		NavigationTreeShowFunctions: z.boolean().default(true),
		NavigationTreeShowProcedures: z.boolean().default(true),
		NavigationTreeShowEvents: z.boolean().default(true),
		NavigationWidth: z.number().int().default(240),
		NavigationTreeAutoexpandSingleDb: z.boolean().default(true),

		// Main panel
		ShowStats: z.boolean().default(true),
		ShowPhpInfo: z.boolean().default(false),
		ShowServerInfo: z.boolean().default(true),
		ShowChgPassword: z.boolean().default(true),
		ShowCreateDb: z.boolean().default(true),
		ShowDbStructureCharset: z.boolean().default(false),
		ShowDbStructureComment: z.boolean().default(false),
		ShowDbStructureCreation: z.boolean().default(false),
		ShowDbStructureLastUpdate: z.boolean().default(false),
		ShowDbStructureLastCheck: z.boolean().default(false),
		HideStructureActions: z.boolean().default(true),
		ShowColumnComments: z.boolean().default(true),
		TableNavigationLinksMode: z.enum(['icons', 'text', 'both']).default('icons'),

		// Browse mode
		ShowAll: z.boolean().default(false),
		MaxRows: z.number().int().positive().default(25),
		Order: z.enum(['ASC', 'DESC', 'SMART']).default('SMART'),
		RowActionLinks: z.enum(['none', 'left', 'right', 'both']).default('left'),
		RowActionType: z.enum(['icons', 'text', 'both']).default('both'),
		RepeatCells: z.number().int().min(0).default(100),
		SaveCellsAtOnce: z.boolean().default(false),
		BrowseMIME: z.boolean().default(true),
		GridEditing: z.enum(['double-click', 'click', 'disabled']).default('double-click'),
		RelationalDisplay: z.enum(['K', 'D']).default('K'),
		ProtectBinary: z.union([z.enum(['blob', 'noblob', 'all']), z.literal(false)]).default('blob'),
		ShowFunctionFields: z.boolean().default(true),
		ShowFieldTypesInDataEditView: z.boolean().default(true),
		CharEditing: z.enum(['input', 'textarea']).default('input'),
		MinSizeForInputField: z.number().int().default(4),
		MaxSizeForInputField: z.number().int().default(60),
		InsertRows: z.number().int().default(2),
		ForeignKeyDropdownOrder: z.array(z.string()).default(['content-id', 'id-content']),
		ForeignKeyMaxLimit: z.number().int().default(100),
		DefaultForeignKeyChecks: z.enum(['default', 'enable', 'disable']).default('default'),

		// Export/compression
		ZipDump: z.boolean().default(true),
		GZipDump: z.boolean().default(true),
		BZipDump: z.boolean().default(true),
		CompressOnFly: z.boolean().default(true),

		// Tabs
		TabsMode: z.enum(['icons', 'text', 'both']).default('both'),
		ActionLinksMode: z.enum(['icons', 'text', 'both']).default('both'),
		PropertiesNumColumns: z.number().int().default(1),
		DefaultTabServer: z.string().default('welcome'),
		DefaultTabDatabase: z.string().default('structure'),
		DefaultTabTable: z.string().default('browse'),

		// Languages / charsets
		DefaultLang: z.string().default('en'),
		DefaultConnectionCollation: z.string().default('utf8mb4_unicode_ci'),
		Lang: z.string().default(''),
		FilterLanguages: z.string().default(''),

		// Text areas / editing
		TextareaCols: z.number().int().default(40),
		TextareaRows: z.number().int().default(15),
		LongtextDoubleTextarea: z.boolean().default(true),
		TextareaAutoSelect: z.boolean().default(false),
		CharTextareaCols: z.number().int().default(40),
		CharTextareaRows: z.number().int().default(7),
		LimitChars: z.number().int().default(50),
		RememberSorting: z.boolean().default(true),
		ShowBrowseComments: z.boolean().default(true),
		ShowPropertyComments: z.boolean().default(true),
		QueryHistoryDB: z.boolean().default(false),
		QueryHistoryMax: z.number().int().default(25),
		MaxExactCount: z.number().int().default(50000),
		MaxExactCountViews: z.number().int().default(0),

		// Themes
		ThemeManager: z.boolean().default(true),
		ThemeDefault: z.string().default('pmahomme'),
		ThemePerServer: z.boolean().default(false),

		DefaultQueryTable: z.string().default('SELECT * FROM @TABLE@ WHERE 1'),
		DefaultQueryDatabase: z.string().default(''),
		UploadDir: z.string().default(''),
		SaveDir: z.string().default(''),
		LinkLengthLimit: z.number().int().default(1000),
		DefaultFunctions: z.record(z.string(), z.string()).default({
			FUNC_CHAR: '',
			FUNC_DATE: '',
			FUNC_NUMBER: '',
			FUNC_SPATIAL: 'GeomFromText',
			FUNC_UUID: 'UUID',
			first_timestamp: 'NOW'
		}),
		maxRowPlotLimit: z.number().int().default(500),

		// Sub-trees (Export/Import options are modelled later with their features)
		Export: z.record(z.string(), z.unknown()).default({}),
		Import: z.record(z.string(), z.unknown()).default({})
	})
	.loose();

export type AppConfig = z.infer<typeof configSchema>;
export type AppConfigInput = z.input<typeof configSchema>;
