# svelteMyAdmin — Roadmap

A modern, JavaScript/TypeScript re-implementation of **phpMyAdmin 5.2.3** (reference sources in
`../phpMyAdmin-5_2_3`) built with **SvelteKit + Svelte 5**. Goal: feature parity where it makes sense,
with a modern UI and a maintainable test suite.

## Architecture decisions

| Concern              | Choice                                                                | Why                                              |
| -------------------- | --------------------------------------------------------------------- | ------------------------------------------------ |
| Framework            | SvelteKit 3, Svelte 5 (runes), TypeScript strict                      | Requested; SSR + server endpoints in one app     |
| Runtime              | `@sveltejs/adapter-node`                                              | DB connections need a long-lived Node server     |
| DB driver            | `mysql2/promise`                                                      | MySQL + MariaDB, multi-statement, streaming rows |
| Styling              | Tailwind CSS v4 + shadcn-svelte (bits-ui) + mode-watcher | Modern look, light/dark themes                   |
| SQL editor           | CodeMirror 6 (`@codemirror/lang-sql`, MySQL dialect)                  | Highlighting + schema autocompletion             |
| Validation           | `zod` on every form action / endpoint                                 | Typed, testable input handling                   |
| Unit/component tests | Vitest (+ `vitest-browser-svelte` for components)                     | Fast, co-located `*.test.ts`                     |
| DB integration tests | Vitest project `integration` against Docker MySQL 8.4 + MariaDB 11.4  | Real server behaviour                            |
| E2E                  | Playwright                                                            | Critical user flows                              |
| Package manager      | pnpm                                                                  |                                                  |

### Server-side layout

- `src/lib/server/config/` — loads `config.json` (and env overrides) using **the same keys as phpMyAdmin's
  `$cfg`** (`Servers[i].host`, `port`, `auth_type`, `controluser`, `pmadb`, `MaxRows`, …).
- `src/lib/server/auth/` — auth plugins: `cookie` (default, login form), `config`, `http`; `signon` later.
  Credentials are stored AES-256-GCM encrypted in an http-only cookie keyed by `blowfish_secret`.
- `src/lib/server/db/` — connection per request from a per-user pool, `escapeId`/`escapeValue` helpers,
  `DatabaseInterface`-like service (`listDatabases`, `getTables`, `getColumns`, `getIndexes`, …),
  SQL statement splitter (supports `DELIMITER`, comments, quoted strings).
- `src/lib/server/pmadb/` — phpMyAdmin configuration storage (`pma__*` tables), feature-detected per table.
- `src/lib/server/export/`, `src/lib/server/import/` — plugin registry mirroring `Plugins/Export|Import`.

### Routing (mirrors phpMyAdmin's `?route=` tree)

```
/login  /logout
/server/{databases,sql,status,status/processes,status/monitor,variables,charsets,engines,plugins,
         privileges,binlog,replication,export,import,user-groups}
/db/[db]/{structure,sql,search,query,export,import,operations,privileges,routines,events,triggers,
          designer,data-dictionary,central-columns,tracking}
/db/[db]/table/[table]/{browse,structure,sql,search,zoom-search,find-replace,insert,export,import,
                        privileges,operations,tracking,triggers,relation,indexes,partitions,chart}
```

Legacy `index.php?route=/table/sql&db=x&table=y` URLs are redirected to the new paths.

## Compatibility with phpMyAdmin

1. **Config keys** identical to `$cfg` (a JSON `config.json` instead of `config.inc.php`).
2. **Configuration storage**: uses the exact `pma__*` tables from `sql/create_tables.sql`
   (bookmarks, relations, column_info/transformations, history, recent, favorite, table_uiprefs,
   table_info, table_coords, pdf_pages, userconfig, users/usergroups, navigationhiding, savedsearches,
   central_columns, designer_settings, export_templates, tracking). Both apps can share one pmadb.
3. **Export formats** byte-compatible where practical (SQL dump header/structure, CSV, JSON, XML) so
   dumps round-trip between the two tools.
4. **Legacy URL** redirects (see above).
5. **Auth types** `cookie`, `config`, `http` (+ `signon` later), `AllowNoPassword`, `AllowRoot`,
   `AllowDeny` rules.

## Phases

Legend — model: **S** = Sonnet 5.5 (complex/structural), **H** = Haiku 5.5 (mechanical/simple).

### Phase 0 — Foundation (S)

- SvelteKit scaffold, Tailwind v4, ESLint/Prettier, Vitest (unit + integration projects), Playwright.
- `docker-compose.yml` with MySQL 8.4 + MariaDB 11.4 and a seed fixture DB; `pnpm db:up`.
- Config loader + types, `escapeId`/`escapeString`, SQL statement splitter — all unit-tested.
- `AGENTS.md` / `CLAUDE.md` conventions for implementers.

### Phase 1 — Auth & app shell (S)

- Cookie login (server selector, language), logout, session encryption, `config` auth.
- Layout: left navigation tree (servers → dbs → tables/views/routines/events/functions, filter box,
  lazy loading), top breadcrumbs, tab bars per level (server/db/table), light/dark theme, toasts.
- Home page: server info, web server info, version, appearance settings.
- i18n scaffold (English first; message ids so phpMyAdmin `.po` files can be reused later).

### Phase 2 — Server level

- Databases list: create (collation), drop multiple, statistics toggle (S)
- SQL query page (shared component, see Phase 5) (S)
- Variables (search, inline edit session/global) (H)
- Charsets & collations, Engines (+ `SHOW ENGINE ... STATUS`), Plugins, Binary log (H)
- Status: server, processes (kill), query statistics, all status vars, advisor later (S)
- Replication status (read-only first) (H)

### Phase 3 — Database level

- Structure: tables/views list with rows, size, overhead, engine, collation; bulk actions
  (browse, empty, drop, check/optimize/repair/analyze, add prefix, copy) (S)
- Create table / view (column definition editor shared with table structure) (S)
- Operations: rename, copy (structure/data), collation change, comment, drop (S)
- Routines, Events, Triggers: list, create/edit (editor dialogs), drop, export (S)
- Search across tables (H), Query by example / multi-table query (S), Data dictionary (H)

### Phase 4 — Table level

- **Browse** (S, largest piece): pagination, sorting, column visibility/order, inline + grid edit,
  multi-row edit/delete/export, foreign key links & dropdowns, BLOB/binary/geometry display,
  full/partial text, "show all", remembered UI prefs (`pma__table_uiprefs`).
- Structure: columns add/edit/drop/move, primary/unique/index/fulltext/spatial shortcuts,
  indexes editor, partitions, relation view (FKs + internal relations), central columns (S)
- Insert / Edit rows: per-type inputs, functions (NOW(), UUID(), …), NULL toggle, insert-as-new (S)
- Search, Zoom search (scatter chart), Find & replace (S)
- Operations: rename/move, options (engine, auto_increment, comment, row format), copy,
  maintenance, truncate/drop (S)
- Triggers (reuse db-level), Privileges (reuse Phase 7), Chart from result (H)

### Phase 5 — SQL engine & editor (S)

- Multi-statement execution with `DELIMITER`, per-statement results, affected rows, warnings,
  timing, profiling, `EXPLAIN` view, "edit inline", "create PHP code", "create view".
- CodeMirror editor with schema-aware autocompletion, format SQL, query history (`pma__history`),
  bookmarks (`pma__bookmark`), console panel (bottom drawer like phpMyAdmin's console).

### Phase 6 — Import / Export

- Export (server/db/table/rows): quick & custom modes, streamed downloads, gzip/zip compression,
  export templates (`pma__export_templates`). Formats: SQL, CSV, CSV-for-Excel, JSON, XML, YAML,
  Markdown/Texy, LaTeX, MediaWiki, PHP array, HTML-Word, ODS/ODT, Codegen. SQL first (S), others (H).
- Import: SQL (streamed, partial import/resume), CSV, LOAD DATA, ODS, XML, MediaWiki, SHP later (S).

### Phase 7 — Users & privileges (S)

- User accounts overview, add/edit/drop users, global/db/table/column/routine privileges,
  roles (MariaDB/MySQL 8), resource limits, SSL, change password, login information,
  user groups (`pma__users`, `pma__usergroups`).

### Phase 8 — Configuration storage features (S/H)

- Auto-detect / one-click create pmadb, recent & favorite tables, navigation hiding,
  column transformations (display + input), saved searches, central columns, tracking,
  user preferences (`pma__userconfig`) with the same preference keys.

### Phase 9 — Advanced

- Designer (ER diagram, relations drag & drop, PDF/SVG schema export) (S)
- Status monitor charts, Advisor rules (S), Normalization wizard (S), GIS visualization (S)
- Two-factor auth, setup wizard, error reporting (H/S)

## Working process (orchestration)

1. Orchestrator writes a precise task brief (scope, files, reference PHP files, acceptance tests).
2. `builder` subagent (Sonnet or Haiku per table above) implements with tests.
3. `checker` subagent runs `pnpm check && pnpm lint && pnpm test` (+ integration when DB is up).
4. Orchestrator reviews the diff, commits locally, updates this roadmap's checklist.

## Progress

- [x] Phase 0 — Foundation
- [x] Phase 1 — Auth & shell
- [x] Phase 2 — Server level (SQL tab → Phase 5)
- [ ] Phase 3 — Database level
- [ ] Phase 4 — Table level
- [ ] Phase 5 — SQL engine & editor
- [ ] Phase 6 — Import / Export
- [ ] Phase 7 — Users & privileges
- [ ] Phase 8 — Configuration storage
- [ ] Phase 9 — Advanced
