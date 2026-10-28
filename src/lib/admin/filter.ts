/**
 * Client-side filter boxes (server variables, plugins). Pure: shared by the browser and tests.
 */

/**
 * Case-insensitive substring match of `query` against any of `fields`.
 * An empty (or blank) query matches everything; null/undefined fields never match.
 */
export function matchesFilter(query: string, ...fields: (string | null | undefined)[]): boolean {
	const needle = query.trim().toLowerCase();
	if (needle === '') return true;
	return fields.some(
		(field) => field !== null && field !== undefined && field.toLowerCase().includes(needle)
	);
}
