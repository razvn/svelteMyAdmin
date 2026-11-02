---
name: verify-sveltemyadmin
description: Drive the real svelteMyAdmin web UI (built app + Docker MySQL 8.4 / MariaDB 11.4) the way a user does and capture proof (screenshots, ARIA snapshots, DB side effects). Use to prove a UI change or bug fix works end to end, beyond the e2e suite, or to reproduce a user-reported behavior.
---

# Verify svelteMyAdmin

Everything goes through `sma-verify` (next to this file). Run it from the repo root. Every command needs
`SMA_RUN_ID`, a short `[a-z0-9]` id of your choosing. It names your state dir, your evidence dir and
your temporary databases (`tmp_verify_<id>_*`). Pick a new id per task. Two runs with different ids can
be up at the same time.

```bash
export SMA_RUN_ID=fix123                       # one per verification task
S=.claude/skills/verify-sveltemyadmin/sma-verify
$S up                                          # DBs + build + app; prints READY <url>
$S doctor                                      # must print DOCTOR OK before you drive
$S run .claude/skills/verify-sveltemyadmin/journeys/sql-query.ts
$S down                                        # always, also after a failed run
```

## What is shared and what is yours

- **Shared:** the Docker stack (`sma-mysql` :33306, `sma-mariadb` :33307, root/root). It is the dev and
  e2e database too. `up` starts it if needed (`pnpm db:up`) and `down` leaves it running. Never run
  `pnpm db:down` (it deletes the data). Never touch `sma_test` or other users' databases. Put everything
  you create in `tmpDb('<suffix>')` = `tmp_verify_<id>_<suffix>`.
- **Shared:** `build/`. `up` rebuilds it. Do not run `up` while another run or `pnpm test:e2e` is building.
  Use `up --no-build` when doctor says the build is fresh.
- **Yours:** one `vite preview` process on the first free port from 4300, a per-run config
  (`var/verify/<id>/state/config.json`, the `config.sample.json` servers with SQLite storage in the
  state dir), and `var/verify/<id>/evidence/`. Never drive an instance another run started, the
  developer's `pnpm dev` (:5173), or the e2e preview (:4173).

## Launch

`$S up [--no-build]` does the following:

1. Runs `pnpm db:up`, then waits until `sma_test` exists on both servers, `phpmyadmin.pma__bookmark`
   exists and user `pma` can log in. The container health check passes while the init scripts are still
   running, so the script does not trust it.
2. Runs `pnpm build`. Its log goes to `state/build.log`.
3. Writes the per-run config and starts `vite preview --host 127.0.0.1 --port <free>`.
4. Waits until `/api/health` answers `{"ok":true}` and `/login` renders the password field, then prints
   `READY http://127.0.0.1:<port>`.

A cold `up` takes a few minutes (most of it is the build). Run it in the background or with a long
timeout. The server log is `evidence/server.log`.

Do not start the app with `node build` for verification. adapter-node 6 has no `ORIGIN` variable and
assumes `https` without a `PROTOCOL_HEADER`, so every form POST over plain http fails with
`403 Cross-site POST form submissions are forbidden`.

## Doctor

`$S doctor` is read-only. It checks that the pid is alive, that the pid owns the port, that health
answers, that the fixtures are reachable, and that no `src/` file is newer than `build/index.js`. It
exits 1 and prints `DOCTOR FAIL` otherwise. Run it before driving and again whenever something looks
off. `STALE` means you edited code after building: run `down`, then `up`.

## Drive

A journey is a plain TypeScript file that Node runs directly. It imports `lib.ts`, and
`$S run <file>` provides the URL and evidence dir. Copy `journeys/sql-query.ts` as a template:

```ts
import { expect, gotoReady, journey, login, tmpDb, withRoot } from '../lib.ts';
await journey('<feature-id>', async ({ page, step, proof, save }) => {
	await login(page); // real login form, root/root, server 1; login(page, { server: 2 }) for MariaDB
	step('what the user does -> what they should see');
	await gotoReady(page, '/db/sma_test/table/books/browse'); // never page.goto
	await expect(page.getByRole('main').getByTestId('rows-message')).toContainText('4 total');
	await proof('books-browse');
});
```

- `gotoReady` waits for `html[data-hydrated="true"]`. Controls are inert until then, so a click
  before hydration is silently lost.
- Scope locators to `page.getByRole('main')`. The sidebar, breadcrumbs and tab bar repeat db and table
  names. Prefer roles, labels and `data-testid` (`statement-message`, `rows-message`, `insert-result`,
  `export-submit`, `nav-db-<db>`, ...), never coordinates. `e2e/*.e2e.ts` is the catalogue of working
  locators for each page.
- `SMA_HEADED=1 $S run <file>` shows the browser.
- Servers (login `server` index): 1 = MySQL 8.4 with pmadb `phpmyadmin`, 2 = MariaDB 11.4 with SQLite
  storage, 3 = MariaDB 11.4 without storage.
- The feature map in `features/` gives the route, steps and expected result for each feature. Read
  `features/README.md` first.

## Evidence

Each journey writes `var/verify/<id>/evidence/<feature-id>/`:

- `journal.md` lists the steps, every artifact, and `RESULT: PASS` or `FAIL` with the stack. On a
  failure it also has `NN-failure.png` and `.aria.txt`.
- `proof(name)` writes `NN-name.png` (full page, 1440x900) and `NN-name.aria.txt` (URL + ARIA tree).
- `save(file, content)` writes query results and downloaded files.

Proof standards:

- Drive the real user path (forms, buttons, links). `withRoot` is only for preconditions and for
  reading side effects, never for doing the thing under test.
- Capture the action and the resulting state, not only the final screen.
- After any write through the UI (insert, alter, import, privileges, settings), read the stored value
  back from MySQL with `withRoot`, or open it in a second UI view, and `save` it.
- No mocks: the databases are real.
- `$S run` exits 1 on a failed journey. Report the failure with its journal. Never relax an assertion
  to get a pass.

## Cleanup

`$S down` does the following:

- Stops only the pid recorded for this run, and only if that pid is still `vite.js preview` on this
  run's port. It prints `stopped pid N`. If that line is missing while doctor showed the process alive,
  stop the pid from `state/pid` yourself before deleting anything.
- Drops every `tmp_verify_<id>_*` database on both servers.
- Deletes this run's `pma__table_uiprefs` and `pma__history` rows.
- Removes `var/verify/<id>/state/`.

Evidence stays in `var/verify/<id>/evidence/` (git-ignored). Delete it yourself when it is no longer
needed. Journeys should also drop their own databases in `finally`. `down` is the safety net. Run
`down` after every run, including failed ones.
