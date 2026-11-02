# Insert a row

The Insert tab shows one form block per new row, with a function, null and value control per column.
A second block stays ignored until the user types into it. Go inserts the rows and reports
`N rows affected`, with the generated SQL available.

## Sub-features

- `insert-one`: one row is inserted, and `insert-result` reports it.
- `insert-two`: typing into row 2 unchecks `Ignore row 2`, and both rows are inserted.
- `insert-sql`: the `SQL query` button in `insert-result` reveals `insert-sql` with `INSERT INTO`.
- `insert-after`: `After saving` set to `new_insert` returns a blank form.

## How to get to it (user POV)

- Table tab bar, `Insert` tab. Route `/db/<db>/table/<table>/insert`.
- Browse, row `Edit` (signed URL, same form in edit mode).

## Driving it with sma-verify

Preconditions:

- Baseline from the README, plus a `tmpDb('insert')` table
  `items (id int AUTO_INCREMENT PRIMARY KEY, name varchar(40) NOT NULL, qty int NOT NULL DEFAULT 0)`.

Steps:

- **Open.** `gotoReady(page, '/db/<db>/table/items/insert')`. `insert-row-0` has columnheader
  `Function`.
- **Fill.** In `insert-row-0`, fill label `Value of name` with `first` and `Value of qty` with `3`.
  In `insert-row-1`, fill `Value of name` with `it's second`. The checkbox `Ignore row 2` becomes
  unchecked.
- **Save.** Click button `Go` (exact). `insert-result` contains `2 rows affected`.
- **Side effect.** `withRoot` SELECT name, qty FROM items returns `first`/3 and `it's second`/0. Save it.
- **Proof.** `proof('insert-result')` after Go, plus the saved rows JSON.

## Gotchas

- Row 2 is ignored until typed into. Asserting on it before typing proves nothing.
- Edit links carry a signature (`sig=`) made with `blowfish_secret`. Reach them from Browse, not from a
  hand-built URL.
- Quotes in values (`it's`) are the escaping check. Keep one in the journey.
