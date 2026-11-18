# Upgrade Svelte / SvelteKit (paste into any project)

Goal: bump Svelte, SvelteKit and their companion packages to the newest releases, with zero reasoning.
Follow the steps in order. Do not skip the verify step. Do not bypass the release-age cooldown.

## 0. Preconditions

1. Work on a clean git tree: `git status --short` must print nothing. If not, stop and ask.
2. Detect the package manager from the lockfile and use ONLY that one:
   - `pnpm-lock.yaml` → `pnpm` · `package-lock.json` → `npm` · `yarn.lock` → `yarn` · `bun.lock`/`bun.lockb` → `bun`
3. Read `engines.node` in `package.json`; `node -v` must satisfy it.

## 1. Packages to bump

Bump every one of these that appears in `package.json` (skip the ones that don't):

```
svelte
@sveltejs/kit
@sveltejs/vite-plugin-svelte
@sveltejs/adapter-node   (or adapter-auto / adapter-static / adapter-cloudflare / adapter-vercel — whichever is installed)
svelte-check
vite
```

Do NOT bump `typescript` to a new major (Svelte tooling lags behind TypeScript majors). Keep the current major.

## 2. Run the upgrade

pnpm:

```bash
pnpm update --latest svelte @sveltejs/kit @sveltejs/vite-plugin-svelte @sveltejs/adapter-node svelte-check vite
```

npm:

```bash
npm install -D svelte@latest @sveltejs/kit@latest @sveltejs/vite-plugin-svelte@latest @sveltejs/adapter-node@latest svelte-check@latest vite@latest
```

(Replace the adapter name with the one the project really uses. Drop any package the project doesn't have, otherwise the command ADDS it.)

## 3. Known behavior: "latest" may not be the newest on npm

pnpm 10.16+/12 enforces a release-age cooldown (supply-chain protection). Versions published in the last day or so are skipped silently, so `pnpm ls` can show a version one patch behind `npm view <pkg> version`. This is expected.
Do NOT disable the cooldown (`minimumReleaseAge`, `--config.minimumReleaseAge=0`, etc.). Re-run the upgrade in a day or two to pick up the newest patch.

## 4. Verify (all must pass)

Run each script that exists in `package.json`, in this order. Stop at the first failure.

```bash
pnpm check        # svelte-kit sync + svelte-check: expect 0 errors, 0 warnings
pnpm lint         # if present
pnpm test         # or test:unit, if present
pnpm build        # must finish without errors
```

## 5. If something fails

1. Read the first error only. Find the package that owns it.
2. Look up the breaking change: `https://github.com/sveltejs/kit/blob/main/packages/kit/CHANGELOG.md`, `https://github.com/sveltejs/svelte/blob/main/packages/svelte/CHANGELOG.md`, or the matching `CHANGELOG.md` in the `sveltejs/vite-plugin-svelte` repo. Search for the version range you crossed.
3. Apply the documented migration. Re-run step 4.
4. If a peer-dependency warning mentions a third-party package (bits-ui, shadcn-svelte, svelte-sonner, ...), bump that package too with the same command style, then re-verify.
5. If you cannot fix it in three attempts: `git checkout -- package.json <lockfile>` and reinstall, then report which package and which error blocked you.

## 6. Finish

1. `git diff --stat` must only touch `package.json`, the lockfile, and files changed for a documented migration.
2. Commit: `chore(deps): upgrade svelte, sveltekit and tooling`.
3. Report: old → new version for each bumped package, and any package that was held back by the cooldown.
