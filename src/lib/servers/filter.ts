/**
 * Server pickers (login select, top-bar switcher) can list dozens of servers. These helpers narrow the list
 * with a free-text query. Pure logic: no DOM, no server-only imports (the pickers run in the browser).
 */

/** A configured server as listed in a picker. `index` is the 1-based form value. */
export interface PickableServer {
	index: number;
	label: string;
	host?: string;
	port?: number;
}

/**
 * Case-insensitive match of `query` against the label (verbose name or host:port), the host, the port and
 * `host:port`. A blank query matches everything.
 */
export function serverMatches(server: PickableServer, query: string): boolean {
	const needle = query.trim().toLowerCase();
	if (needle === '') return true;
	const host = (server.host ?? '').toLowerCase();
	const port = server.port ? String(server.port) : '';
	const hostPort = host && port ? `${host}:${port}` : '';
	return [server.label.toLowerCase(), host, port, hostPort].some((field) => field.includes(needle));
}

/** The servers matching `query`, in their original order. */
export function filterServers<T extends PickableServer>(servers: readonly T[], query: string): T[] {
	return servers.filter((server) => serverMatches(server, query));
}

/**
 * The index a picker should select after a filter change: the current one when it is still listed, else the
 * first match, else `undefined` (nothing matches, the picker shows a hint and blocks submitting).
 */
export function selectionAfterFilter(
	matches: readonly PickableServer[],
	selected: number
): number | undefined {
	if (matches.some((server) => server.index === selected)) return selected;
	return matches[0]?.index;
}
