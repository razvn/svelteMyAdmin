# svelteMyAdmin verification map

This directory is the maintained source for verifying the user-facing behavior of svelteMyAdmin. Read
this index before driving the app, then use the matching feature file as the recipe. The app mirrors
phpMyAdmin 5.2.3 (`docs/ROADMAP.md` lists every route). This map covers the core journeys first. Add a
file when you verify a feature that is not listed here.

## Baseline preconditions

- `SMA_RUN_ID` is set, `sma-verify up` printed `READY`, and `sma-verify doctor` printed `DOCTOR OK`.
- The fixture database `sma_test` exists on both servers: `authors`, `books` (4 rows, including
  `Solaris`, `The Left Hand of Darkness` and `Unpublished Draft`), `type_zoo`, `audit_log`, the view
  `v_book_authors` and the procedure `sp_books_by_author`. Treat it as read-only.
- Mutating journeys create their own `tmpDb('<suffix>')` through `withRoot` and drop it in `finally`.
- Login is `root` / `root`. Server 1 is MySQL 8.4 with pmadb, server 2 is MariaDB 11.4 with SQLite
  storage, and server 3 is MariaDB without storage.

## Driving conventions

- Write one journey file per feature in `../journeys/<feature-id>.ts` and run it with `sma-verify run`.
- Navigate only with `gotoReady`. Scope locators to `page.getByRole('main')`.
- Use ARIA roles, accessible names and `data-testid`, not CSS or position. Quoted names are literal.
- The SQL editor is CodeMirror. Address it as `getByRole('textbox', { name: 'SQL query' })` and use
  `.fill()` on it.
- bits-ui selects open with a click on the `combobox`, then a click on `getByRole('option', { name })`.
  Native selects use `selectOption`.

## Proof and skip reporting

- UI proof is `proof(name)`: a screenshot plus an ARIA snapshot with the URL. The header shows
  `root@127.0.0.1:<port>` and the breadcrumbs show the server, which identifies the instance.
- Mutation proof also includes a `withRoot` read of the stored rows, kept with `save()`.
- Download proof includes the suggested file name and the saved file content.
- Report a journey that cannot run with the command, the unmet precondition and `journal.md`. Do not
  report a feature as verified through a different entry point than the one the map lists.

## Feature entry contract

Each feature file starts with an H1 title and one paragraph of user-visible behavior, then exactly four
H2 sections in this order: `Sub-features`, `How to get to it (user POV)`,
`Driving it with sma-verify`, `Gotchas`.

## Features

- [Log in and home](./login-home.md): cookie login, wrong password, redirect after login, home page, logout.
- [Run SQL](./sql-query.md): SQL pages at server, database and table level. Results, writes, errors.
  The journey is `journeys/sql-query.ts` (proven).
- [Browse a table](./table-browse.md): grid, sorting by header, pagination, rows per page.
- [Insert a row](./table-insert.md): insert form, multi-row insert, persisted values.
- [Export](./export.md): quick SQL export of a database, downloaded file content.
