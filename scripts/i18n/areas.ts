/**
 * Which catalog area a source file belongs to. First matching rule wins; anything unmatched is `common`.
 * Paths are repo-relative with `/` separators. The same table is documented in docs/I18N.md: follow-up
 * work is split by area, and each area only ever touches `locales/<lang>/<area>.json`.
 *
 *   io        import / export (pages, components, lib, server)
 *   admin     privileges, user settings (preferences), two-factor, monitor, advisor, designer, GIS, normalization
 *   sql       SQL console/editor/query pages, bookmarks, history, QBE, DB search, `**\/sql`, `**\/query`
 *   server    server-level pages (databases, variables, status, engines, plugins, replication, ...)
 *   table     everything under a table + shared table building blocks (results, structure, columns, tracking)
 *   database  database-level pages and components
 *   shell     app shell: login/logout, home, navigation tree, console, top bar, hooks, language select
 *   common    shared widgets, i18n runtime, formatting, anything else
 */
import type { Area } from './lib.ts';

const RULES: Array<[Area, RegExp]> = [
	[
		'io',
		/^src\/lib\/(components\/(export|import)|import|server\/(export|import))\/|^src\/routes\/api\/import\/|^src\/routes\/.*\/(export|import)(\/|$)/
	],
	[
		'admin',
		new RegExp(
			[
				String.raw`^src/lib/components/(privileges|preferences|two-factor|monitor|designer)/`,
				String.raw`^src/lib/(advisor|designer|gis|monitor|preferences|two-factor)/`,
				String.raw`^src/lib/sql/(privileges|normalization)`,
				String.raw`^src/lib/server/(privileges|designer|two-factor|preferences)/`,
				String.raw`^src/routes/\(app\)/server/(privileges|settings)(/|$)`,
				String.raw`^src/routes/\(app\)/server/status/(monitor|advisor)(/|$)`,
				String.raw`^src/routes/.*/(privileges|designer|gis|normalization)(/|$)`,
				String.raw`^src/routes/login/2fa/`
			].join('|')
		)
	],
	[
		'sql',
		new RegExp(
			[
				String.raw`^src/lib/components/(sql|sql-editor|query)/`,
				String.raw`^src/lib/sql/(editor/|bookmark|history|classify|messages|run-types|limit|statement|templates|tokens|query-schema|qbe|multi-table-query|result-sort|db-search|escape)`,
				String.raw`^src/lib/server/sql/`,
				String.raw`^src/routes/api/sql/`,
				String.raw`^src/routes/.*/(sql|query)(/|$)`
			].join('|')
		)
	],
	[
		'server',
		/^src\/routes\/\(app\)\/server\/|^src\/lib\/admin\/|^src\/lib\/server\/(admin|pmadb)\//
	],
	[
		'table',
		new RegExp(
			[
				String.raw`^src/lib/components/(table|table-search|table-structure|columns|results|tracking|transformations)/`,
				String.raw`^src/lib/(table|tracking|transformations|sql)/`,
				String.raw`^src/lib/server/(table|transformations)/`,
				String.raw`^src/routes/\(app\)/db/\[db\]/table/`,
				String.raw`^src/routes/\(app\)/transformations/`,
				String.raw`^src/routes/api/central-columns/`,
				String.raw`^src/routes/\(app\)/db/\[db\]/central-columns/`
			].join('|')
		)
	],
	[
		'database',
		/^src\/lib\/components\/database\/|^src\/lib\/server\/database\/|^src\/routes\/\(app\)\/db\//
	],
	[
		'shell',
		new RegExp(
			[
				String.raw`^src/(hooks\.server|app)\.`,
				String.raw`^src/routes/(login|logout)(/|$)`,
				String.raw`^src/routes/api/(navigation|health|lang)/`,
				String.raw`^src/routes/(\(app\)/)?[+]`,
				String.raw`^src/lib/components/(app-shell|home|navigation|console|i18n)/`,
				String.raw`^src/lib/components/theme-toggle`,
				String.raw`^src/lib/nav/`,
				String.raw`^src/lib/server/(auth|navigation|routing|config|db|i18n)/`
			].join('|')
		)
	]
];

export function areaOf(path: string): Area {
	const p = path.replace(/\\/g, '/');
	for (const [area, re] of RULES) if (re.test(p)) return area;
	return 'common';
}
