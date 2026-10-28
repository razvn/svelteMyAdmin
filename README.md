# svelteMyAdmin

A SvelteKit + Svelte 5 re-implementation of phpMyAdmin 5.2.3. See `docs/ROADMAP.md` for the plan and
`AGENTS.md` for development conventions.

## Requirements

- Node.js >= 22, pnpm
- Docker (optional, for the integration test databases)

## Setup

```sh
pnpm install
cp config.sample.json config.json     # optional; keys match phpMyAdmin's $cfg. Set SMA_CONFIG to use another path
pnpm exec playwright install chromium # browsers for component + e2e tests
pnpm dev
```

## Databases for development / integration tests

```sh
pnpm db:up     # MySQL 8.4 on 127.0.0.1:33306, MariaDB 11.4 on 127.0.0.1:33307 (root / root)
pnpm db:down   # stop and delete data
```

Seeded with the fixture database `sma_test` and the phpMyAdmin configuration storage database
`phpmyadmin` (control user `pma` / `pmapass`).

## Scripts

| Script                           | Purpose                                |
| -------------------------------- | -------------------------------------- |
| `pnpm dev` / `build` / `preview` | develop, build (adapter-node), preview |
| `pnpm check`                     | svelte-check                           |
| `pnpm lint` / `format`           | prettier + eslint                      |
| `pnpm test`                      | unit + browser component tests         |
| `pnpm test:integration`          | SQL tests against the Docker databases |
| `pnpm test:e2e`                  | Playwright end-to-end tests            |
| `pnpm db:up` / `db:down`         | Docker databases                       |

## Production

```sh
pnpm build
SMA_CONFIG=/path/to/config.json node build
```

### Import: upload size and limits

The import page streams the uploaded file (it is never buffered for SQL and CSV), but `adapter-node`
rejects request bodies larger than `BODY_SIZE_LIMIT` (default **512K**). Raise it when you run the
server, e.g. `BODY_SIZE_LIMIT=2G SMA_CONFIG=... node build` (`Infinity` disables the limit). The page
shows the limit and `Import.max_upload_size` in `config.json` can lower it. `ExecTimeLimit` is the time
budget of interruptible imports (resume with the skip count) and `MemoryLimit` caps the formats that are
read into memory (ODS, XML, MediaWiki, CSV at database/server level; default 512M). `LOAD DATA` imports
need `local_infile=ON` on the MySQL server. bzip2 files are not supported.
