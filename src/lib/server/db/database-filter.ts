/**
 * `only_db` / `hide_db` handling (see ListDatabase.php).
 *
 * - `only_db`: string or array. Entries without unescaped wildcards are literal
 *   database names; entries with `%`, `_` (MySQL LIKE wildcards) or `*` (alias of `%`)
 *   are matched against the existing databases. `\_` and `\%` are literal.
 * - `hide_db`: a regular expression; matching databases are removed.
 */

const WILDCARD = /(^|[^\\])(_|%|\*)/;

export function hasWildcard(pattern: string): boolean {
	return WILDCARD.test(pattern);
}

/** Remove the backslash escapes of `\_` and `\%`. */
export function unescapeWildcards(name: string): string {
	return name.replace(/\\([_%])/g, '$1');
}

/** Convert a LIKE pattern (with `*` alias) into an anchored RegExp. */
export function likeToRegExp(pattern: string): RegExp {
	let re = '';
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern[i];
		if (c === '\\' && (pattern[i + 1] === '_' || pattern[i + 1] === '%')) {
			re += pattern[++i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		} else if (c === '%' || c === '*') {
			re += '.*';
		} else if (c === '_') {
			re += '.';
		} else {
			re += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		}
	}
	return new RegExp(`^${re}$`, 's');
}

export function normalizeOnlyDb(onlyDb: string | string[] | undefined): string[] {
	if (Array.isArray(onlyDb)) return onlyDb.filter((s) => s !== '');
	return onlyDb ? [onlyDb] : [];
}

/** Apply `only_db` to the list of all existing databases. Empty config = no restriction. */
export function applyOnlyDb(all: string[], onlyDb: string | string[] | undefined): string[] {
	const patterns = normalizeOnlyDb(onlyDb);
	if (patterns.length === 0) return all;
	const result: string[] = [];
	const seen = new Set<string>();
	const add = (name: string) => {
		if (!seen.has(name)) {
			seen.add(name);
			result.push(name);
		}
	};
	for (const p of patterns) {
		if (!hasWildcard(p)) {
			add(unescapeWildcards(p));
			continue;
		}
		const re = likeToRegExp(p);
		for (const db of all) if (re.test(db)) add(db);
	}
	return result;
}

/** Apply `hide_db` (a regexp source). An invalid regexp hides nothing. */
export function applyHideDb(dbs: string[], hideDb: string | undefined): string[] {
	if (!hideDb) return dbs;
	let re: RegExp;
	try {
		re = new RegExp(hideDb);
	} catch {
		return dbs;
	}
	return dbs.filter((db) => !re.test(db));
}

export function filterDatabases(
	all: string[],
	opts: { only_db?: string | string[]; hide_db?: string }
): string[] {
	return applyHideDb(applyOnlyDb(all, opts.only_db), opts.hide_db);
}
