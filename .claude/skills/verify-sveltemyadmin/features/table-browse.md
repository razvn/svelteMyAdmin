# Browse a table

The Browse tab shows a table's rows in a grid with a row count message, sortable column headers (asc,
desc, cleared), pagination and a rows-per-page selector. The sort and the page size are remembered per
table.

## Sub-features

- `browse-grid`: `rows-message` shows `Showing rows 0 - N` and `T total`, and cells show the values.
- `browse-sort`: header clicks cycle `aria-sort` through ascending, descending and none. The URL gets
  `sort=` and `dir=desc`.
- `browse-sql`: the `SQL query` button reveals `browse-sql` with the ORDER BY.
- `browse-pages`: `Next page` moves 25 rows, and the `Rows per page` combobox changes the page size.

## How to get to it (user POV)

- In the sidebar, expand a database and click a table name.
- Table tab bar, `Browse` tab. Route `/db/<db>/table/<table>/browse`.

## Driving it with sma-verify

Preconditions:

- Baseline from the README. Sorting and paging use a `tmpDb('browse')` table with 60 rows, so the
  remembered prefs never touch `sma_test`.

Steps:

- **Grid.** `gotoReady(page, '/db/sma_test/table/books/browse?sort=')`. `main` `rows-message`
  contains `4 total`, and cell `The Left Hand of Darkness` is visible.
- **Sort.** In the tmp table, click `main` button `title` (exact). `columnheader` `title` has
  `aria-sort="ascending"`. Click it again for descending (URL `dir=desc`). Click a third time to clear
  it (`aria-sort="none"`).
- **SQL.** Click `main` button `SQL query`. `browse-sql` contains ``ORDER BY `title` DESC``.
- **Pages.** On the 60-row table, click `Next page`. `rows-message` contains `Showing rows 25 - 49`.
  Open combobox `Rows per page` and pick option `100 rows`. `rows-message` contains `0 - 59`.
- **Proof.** `proof('sorted-desc')` and `proof('page-2')`. Save a `withRoot` read of
  `phpmyadmin.pma__table_uiprefs` for the tmp table to show the remembered sort.

## Gotchas

- Sorting `sma_test.books` stores a pref in the shared pmadb that changes what e2e specs see. Sort only
  tmp tables. `?sort=` on the URL resets the remembered sort for a read.
- Leave a 60-row table at `25 rows` before cleanup, or drop it (`down` deletes its uiprefs rows).
