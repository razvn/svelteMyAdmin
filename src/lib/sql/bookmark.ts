/**
 * Bookmark placeholders (libraries/classes/Bookmark.php: getVariableCount / applyVariables).
 * `[VARIABLE1]`, `[VARIABLE2]`, ... and the legacy `[VARIABLE]` are replaced by (escaped) values;
 * a block comment wrapped around a placeholder is removed first so `/* [VARIABLE1] *\/` works.
 */

const PLACEHOLDER = /\[VARIABLE[0-9]*\]/g;
const COMMENT_AROUND = /\/\*([\s\S]*?\[VARIABLE[0-9]*\][\s\S]*?)\*\//gi;

/** Number of placeholders in the query (every occurrence counts, like phpMyAdmin). */
export function countVariables(query: string): number {
	return (query.match(PLACEHOLDER) ?? []).length;
}

/** Remove comments enclosing a placeholder (`/* [VARIABLE1] *\/` becomes ` [VARIABLE1] `). */
export function stripVariableComments(query: string): string {
	return query.replace(COMMENT_AROUND, '$1');
}

/**
 * Substitute placeholders. `variables[i - 1]` is the value of `[VARIABLEi]`; an empty or missing
 * value becomes the empty string. `escape` escapes a value for the inside of a SQL string literal.
 */
export function applyVariables(
	query: string,
	variables: readonly (string | undefined)[],
	escape: (value: string) => string
): string {
	const count = countVariables(query);
	let out = stripVariableComments(query);
	for (let i = 1; i <= count; i++) {
		const raw = variables[i - 1];
		const value = raw ? escape(raw) : '';
		out = out.split(`[VARIABLE${i}]`).join(value);
		if (i === 1) out = out.split('[VARIABLE]').join(value);
	}
	return out;
}
