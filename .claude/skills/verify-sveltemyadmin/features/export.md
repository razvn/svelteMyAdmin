# Export

The Export tab lets a user download a database, table or query result in a chosen format, quick (defaults)
or custom (tables, structure/data, compression, file name template). The SQL dump stays compatible with
phpMyAdmin's.

## Sub-features

- `export-quick`: quick SQL export of `sma_test` downloads `sma_test.sql`, containing
  `-- svelteMyAdmin SQL Dump`, ``CREATE TABLE `books` `` and ``INSERT INTO `authors` ``.
- `export-custom`: `Custom - display all possible options` plus `Compression` set to `gzip` gives
  `<db>.sql.gz`.
- `export-text`: view the output as text instead of downloading it.
- `export-levels`: server (`/server/export`), database (`/db/<db>/export`) and table level, plus a
  SQL result's `Export` button.

## How to get to it (user POV)

- Database or table tab bar, `Export` tab.
- The `Export` button under a SQL page result.

## Driving it with sma-verify

Preconditions:

- Baseline from the README. Quick export reads `sma_test` only, so no tmp db is needed.

Steps:

- **Open.** `gotoReady(page, '/db/sma_test/export')`. `main` `export-form` is visible.
- **Download.** Wait for `page.waitForEvent('download')` while clicking `getByTestId('export-submit')`.
  `download.suggestedFilename()` is `sma_test.sql`.
- **Content.** Read `await download.path()`. The text contains the three markers above. Save it with
  `save('sma_test.sql', bytes)`.
- **Proof.** `proof('export-form')` before the click, plus the saved dump.

## Gotchas

- `lib.ts` contexts have `acceptDownloads: true`. Without it the download event never resolves.
- Downloaded files live in a temporary Playwright dir that is deleted when the browser closes. `save`
  them inside the journey.
- Binary formats (ODS, XLSX, PDF) cannot be viewed as text. Assert on the download.
