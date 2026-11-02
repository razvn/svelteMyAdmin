# Run SQL

A user types SQL into the editor of a SQL page and presses Go. Each statement gets its own result block:
a grid for result sets, `N row(s) affected.` for writes, and an inline `#<code>` error for failures.
The query lands in SQL history.

## Sub-features

- `sql-prefill`: the table SQL page opens with ``SELECT * FROM `<table>` WHERE 1``.
- `sql-select`: a SELECT shows a grid and `Showing rows 0 - N (T total, ...)`.
- `sql-write`: an INSERT/UPDATE shows `1 row affected.`, and the change is in the database.
- `sql-multi`: a `;`-separated script shows one `statement-result` block per statement.
- `sql-error`: invalid SQL shows `statement-error` with `#1064`, and `Edit` puts the query back.
- `sql-levels`: the same editor works at server (`/server/sql`), database (`/db/<db>/sql`) and table level.

## How to get to it (user POV)

- Sidebar `SQL query` (server level).
- Database or table tab bar, `SQL` tab.
- The command palette (`Search...` in the header).

## Driving it with sma-verify

Preconditions:

- Baseline from the README. The journey creates `tmp_verify_<id>_sql.books` with rows 1 alpha,
  2 beta and 3 gamma.

Steps:

- **Proven journey.** Run `$S run .claude/skills/verify-sveltemyadmin/journeys/sql-query.ts`. Exit 0
  and `RESULT: PASS` in `evidence/sql-query/journal.md`.
- **Open the page.** `gotoReady(page, '/db/<db>/table/books/sql')`. The `main` textbox `SQL query`
  contains ``SELECT * FROM `books` WHERE 1``.
- **Select.** Fill `SELECT * FROM books WHERE id >= 2`, then click `main` button `Go` (exact).
  `statement-message` contains `(2 total` and the cells `beta` and `gamma` are visible.
- **Write.** Fill `INSERT INTO books VALUES (4, 'delta')`, then click Go. `statement-message`
  contains `1 row affected.`. A `withRoot` SELECT returns 4 rows.
- **Error.** Fill `SELEC 1`, then click Go. `statement-error` contains `#1064`.
- **Proof.** The journey writes `01-select-result`, `02-insert-result`, `03-syntax-error` (.png and
  .aria.txt) and `books-after-insert.json`.

## Gotchas

- Unscoped `getByRole('button', { name: 'Go' })` can match other buttons. Scope it to `main` and use
  `exact: true`.
- Each run writes a row to `phpmyadmin.pma__history` (shared pmadb). `down` deletes the rows for this
  run's databases. Queries on `sma_test` stay in the history.
- `?sql_query=` in the URL only prefills the editor. It never executes, so it does not count as a run.
- The `Recent` sidebar list (pma__recent) keeps entries for this run's tables after they are dropped.
  It is harmless, but it shows up in screenshots of later runs.
