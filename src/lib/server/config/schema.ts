/**
 * Configuration schema. Key names and defaults mirror phpMyAdmin's `$cfg`
 * (libraries/config.default.php). `Servers` is a 0-indexed array here
 * (1-indexed in PHP); `ServerDefault` stays 1-based like in phpMyAdmin.
 */
import { isIP } from 'node:net';
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

/** A single IPv4/IPv6 address or a CIDR range (`10.0.0.0/8`, `fd00::/8`). */
const ipOrCidr = z.string().refine((v) => {
	const [addr, bits, ...rest] = v.split('/');
	const family = isIP(addr);
	if (!family || rest.length > 0) return false;
	if (bits === undefined) return true;
	return /^\d+$/.test(bits) && Number(bits) <= (family === 4 ? 32 : 128);
}, 'must be an IP address or a CIDR range');

/**
 * App-specific, not a phpMyAdmin key: how `auth_type: "signon"` identifies the user. `trusted-header`
 * reads the identity headers of an SSO proxy (oauth2-proxy), only on requests whose TCP peer is one of
 * `trustedProxies`.
 */
/**
 * App-specific: Kubernetes RBAC decides whether the signed-on person may use the server. A
 * SubjectAccessReview asks the API server whether the person may `verb` `resource` in `namespace`.
 */
export const kubernetesSarSchema = z.object({
	type: z.literal('kubernetes-sar'),
	namespace: z
		.string()
		.regex(
			/^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/,
			'must be a Kubernetes namespace name (DNS-1123 label)'
		),
	resource: z
		.object({
			group: z.string().default(''),
			resource: z.string().min(1).default('pods'),
			verb: z.string().min(1).default('get'),
			subresource: z.string().min(1).optional()
		})
		.default({ group: '', resource: 'pods', verb: 'get' }),
	/** Prepended to the identity user, like the API server's `--oidc-username-prefix`. */
	userPrefix: z.string().default(''),
	/** Prepended to every group, like the API server's `--oidc-groups-prefix`. */
	groupsPrefix: z.string().default(''),
	/** How long an answer (allowed or denied) is reused; 0 asks the API server on every request. */
	cacheSeconds: z.number().int().min(0).default(60),
	/** Default: in-cluster, `https://$KUBERNETES_SERVICE_HOST:$KUBERNETES_SERVICE_PORT`. */
	apiServer: z.url({ protocol: /^https?$/ }).optional(),
	tokenFile: z.string().min(1).default('/var/run/secrets/kubernetes.io/serviceaccount/token'),
	caFile: z.string().min(1).default('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt')
});

export type KubernetesSarConfig = z.infer<typeof kubernetesSarSchema>;

/** The RBAC question without the namespace and API access: discovery fills those in per server. */
const sarRulesSchema = kubernetesSarSchema
	.omit({ namespace: true, apiServer: true, tokenFile: true, caFile: true })
	.extend({ type: z.literal('kubernetes-sar').default('kubernetes-sar') });

const PLACEHOLDER = /\{(?:namespace|service|label:[^{}]+|annotation:[^{}]+)\}/g;
/** A text with `{namespace}`, `{service}`, `{label:key}`, `{annotation:key}` placeholders only. */
const template = z
	.string()
	.refine(
		(v) => !/[{}]/.test(v.replace(PLACEHOLDER, '')),
		'allowed placeholders: {namespace}, {service}, {label:key}, {annotation:key}'
	);

/**
 * App-specific (not a phpMyAdmin key): servers found through the Kubernetes API, appended to
 * `Servers`. See docs/SIGNON.md, "Server discovery".
 */
export const serverDiscoverySchema = z.object({
	type: z.literal('kubernetes'),
	/** Label selector on namespaces (`env=review`). */
	namespaceSelector: z.string().min(1),
	/** Label selector on the MySQL Services of those namespaces. */
	serviceSelector: z.string().min(1),
	/** Service port: name or number. A name that is missing falls back to the only port. */
	port: z.union([z.string().min(1), z.number().int().min(1).max(65535)]).default('mysql'),
	host: template.default('{service}.{namespace}.svc'),
	verbose: template.default('{namespace}'),
	/** Secret of the namespace holding the MySQL account the app connects with. */
	secret: z.object({
		name: template.pipe(z.string().min(1)),
		/** Fixed user name, unless `userKey` names a key of the Secret holding it. */
		user: z.string().min(1).default('root'),
		userKey: z.string().min(1).optional(),
		passwordKey: z.string().min(1)
	}),
	/** RBAC check in the server's namespace (on by default); `false` lets every signed-on person in. */
	authorize: z.union([z.literal(false), sarRulesSchema]).default(() => sarRulesSchema.parse({})),
	/** How long the server list and Secrets are reused before asking the API server again. */
	refreshSeconds: z.number().int().min(5).default(30),
	/** Settings of every discovered server (pmadb, Signon.identity, ...), like an entry of `Servers`. */
	server: z.record(z.string(), z.unknown()).default({}),
	apiServer: z.url({ protocol: /^https?$/ }).optional(),
	tokenFile: z.string().min(1).default('/var/run/secrets/kubernetes.io/serviceaccount/token'),
	caFile: z.string().min(1).default('/var/run/secrets/kubernetes.io/serviceaccount/ca.crt')
});
export type ServerDiscoveryConfig = z.infer<typeof serverDiscoverySchema>;

export const signonSchema = z.object({
	identity: z.object({
		type: z.literal('trusted-header').default('trusted-header'),
		userHeader: z.string().min(1).default('x-auth-request-user'),
		emailHeader: z.string().min(1).default('x-auth-request-email'),
		groupsHeader: z.string().min(1).default('x-auth-request-groups'),
		trustedProxies: z.array(ipOrCidr).default([])
	}),
	authorize: kubernetesSarSchema.optional()
});

export type SignonIdentityConfig = z.infer<typeof signonSchema>['identity'];

/** Where a server found by `ServerDiscovery` comes from. */
export interface DiscoveredServer {
	/** Stable id, used in `?server=` and cookies: `k8s:<namespace>/<service>`. */
	id: string;
	namespace: string;
	service: string;
}

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
		/** App-specific, not a phpMyAdmin key: identity source of `auth_type: "signon"`. */
		Signon: signonSchema.optional(),
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
		/**
		 * Derived by the loader (not a phpMyAdmin key, do not set it): absolute path of the SQLite
		 * configuration storage used by this server (top-level `ConfigStorage`, only for servers
		 * without `pmadb`).
		 */
		sqlite_storage: z.string().optional(),
		/** App-specific: `false` keeps this server without configuration storage despite a top-level `ConfigStorage`. */
		ConfigStorage: z.literal(false).optional(),

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
		hide_connection_errors: z.boolean().default(false),
		/** Set by `ServerDiscovery` on the servers it finds; the loader rejects it in `Servers`. */
		discovered: z.custom<DiscoveredServer>().optional()
	})
	// Keep unknown phpMyAdmin keys instead of rejecting them.
	.loose()
	// Trusting identity headers from any peer would let anyone log in by forging them: fail closed.
	.superRefine((server, ctx) => {
		if (server.auth_type === 'signon' && !server.Signon?.identity.trustedProxies.length) {
			ctx.addIssue({
				code: 'custom',
				path: ['Signon', 'identity', 'trustedProxies'],
				message:
					'auth_type "signon" requires the addresses of the SSO proxy (identity headers from anyone else are ignored)'
			});
		}
		if (server.Signon?.authorize && server.auth_type !== 'signon') {
			ctx.addIssue({
				code: 'custom',
				path: ['Signon', 'authorize'],
				message: 'Signon.authorize only applies to auth_type "signon"'
			});
		}
	});

export type ServerConfig = z.infer<typeof serverSchema>;
export type ServerConfigInput = z.input<typeof serverSchema>;

/** App-specific (not a phpMyAdmin key): where servers without `pmadb` keep their configuration storage. */
export const configStorageSchema = z.object({
	type: z.literal('sqlite'),
	/** Relative paths resolve from the directory of the config file. */
	path: z.string().min(1)
});

const auditLogCommon = {
	/** Inline the values passed apart from the SQL text (`query(sql, values)`); off by default (PII). */
	includeValues: z.boolean().default(false),
	/** A person's next request after this much inactivity starts a new `session` event. */
	sessionIdleMinutes: z.number().int().positive().default(30),
	/** Longer SQL text is cut (and marked `truncated`). */
	maxSqlLength: z.number().int().positive().default(4096)
};

/**
 * App-specific (not a phpMyAdmin key): per-person audit log as JSON Lines, see docs/AUDIT.md.
 * Absent = disabled. `file` paths resolve from the directory of the config file.
 */
export const auditLogSchema = z.discriminatedUnion('target', [
	z.object({ target: z.literal('stdout'), ...auditLogCommon }),
	z.object({ target: z.literal('file'), path: z.string().min(1), ...auditLogCommon })
]);
export type AuditLogConfig = z.infer<typeof auditLogSchema>;

/** Link back to the portal that hosts this app (svelteMultiAdmin). Only http(s): it ends up in an `href`. */
export const portalSchema = z.object({
	url: z.url().refine((value) => /^https?:\/\//i.test(value), 'must be an http(s) URL'),
	label: z.string().trim().min(1).default('Portal')
});
export type PortalConfig = z.infer<typeof portalSchema>;

export const configSchema = z
	.object({
		blowfish_secret: z.string().default(''),
		PmaAbsoluteUri: z.string().default(''),
		DBG: z
			.object({ simple2fa: z.boolean().default(false) })
			.loose()
			.default({ simple2fa: false }),
		AllowThirdPartyFraming: z.union([z.boolean(), z.literal('sameorigin')]).default(false),
		Servers: z.array(serverSchema).default([]),
		ConfigStorage: configStorageSchema.optional(),
		/**
		 * Set by svelteMultiAdmin when it hosts this app: where the "Back to <label>" link in the user menu
		 * goes. Absent = no link. Only http(s) URLs: the value ends up in an `href`.
		 */
		Portal: portalSchema.optional(),
		AuditLog: auditLogSchema.optional(),
		ServerDiscovery: serverDiscoverySchema.optional(),
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

		/** User preferences: paths users may not set, and whether the Developer tab is offered. */
		UserprefsDisallow: z.array(z.string()).default([]),
		UserprefsDeveloperTab: z.boolean().default(false),

		// Sub-trees (Export/Import options are modelled later with their features)
		Export: z.record(z.string(), z.unknown()).default({}),
		Import: z.record(z.string(), z.unknown()).default({})
	})
	.loose();

export type AppConfig = z.infer<typeof configSchema>;
export type AppConfigInput = z.input<typeof configSchema>;
