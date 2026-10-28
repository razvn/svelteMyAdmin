/** Shape accepted by `resolve()` as a plain pathname (no leading slash). */
export type RuntimePath = `db/${string}/${string}` & {};

/**
 * `resolve()` from `$app/paths` takes pathnames WITHOUT the leading slash (a leading slash means
 * "route id"). Our URL helpers return normal absolute paths, so strip it: `resolve(bare(path))`.
 *
 * The return type is a pathname template type on purpose: `resolve` only accepts the literal
 * pathnames known to the generated route types, and ours are built at runtime from database and
 * table names.
 */
export const bare = (path: string): RuntimePath =>
	(path.startsWith('/') ? path.slice(1) : path) as RuntimePath;
