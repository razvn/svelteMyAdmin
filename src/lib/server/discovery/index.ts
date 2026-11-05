/**
 * The servers of a request: the configured `Servers`, then the ones `ServerDiscovery` currently finds.
 * Configured servers keep their 1-based position (so it stays usable in URLs and session cookies);
 * discovered ones come and go and are addressed by their stable id (`k8s:<namespace>/<service>`).
 */
import type { AppConfig, ServerConfig } from '../config/schema';
import { createDiscovery, type Discovery, type DiscoveryOptions } from './kubernetes.ts';

/** Remembers the chosen server for auth types without a session cookie of their own. */
export const SERVER_COOKIE = 'sma_server';

let active: { settings: object; discovery: Discovery } | undefined;
let merged: { base: AppConfig; found: ServerConfig[]; config: AppConfig } | undefined;

/**
 * The discovery of this configuration: one per process, replaced when the config is reloaded. Request
 * configs (with the servers merged in) share the `ServerDiscovery` object of their base config.
 */
export function discoveryFor(config: AppConfig, options?: DiscoveryOptions): Discovery | null {
	if (!config.ServerDiscovery) return null;
	if (active?.settings !== config.ServerDiscovery) {
		active = {
			settings: config.ServerDiscovery,
			discovery: createDiscovery(config.ServerDiscovery, config.ConfigStorage?.path, options)
		};
		merged = undefined;
	}
	return active.discovery;
}

/** `config` with the discovered servers appended to `Servers`. Throws when the first listing fails. */
export async function requestConfig(config: AppConfig): Promise<AppConfig> {
	const discovery = discoveryFor(config);
	if (!discovery) return config;
	const found = await discovery.servers();
	if (merged?.base !== config || merged.found !== found) {
		merged = { base: config, found, config: { ...config, Servers: [...config.Servers, ...found] } };
	}
	return merged.config;
}

/** How URLs and cookies name the server at `index` (1-based): its discovery id, else the position. */
export function serverKey(config: Pick<AppConfig, 'Servers'>, index: number): string {
	return config.Servers[index - 1]?.discovered?.id ?? String(index);
}

/** 1-based index of the server named by `key` (a position or a discovery id), null when unknown. */
export function findServerIndex(
	config: Pick<AppConfig, 'Servers'>,
	key: string | null | undefined
): number | null {
	if (!key) return null;
	if (/^\d{1,6}$/.test(key)) {
		const index = Number(key);
		const server = config.Servers[index - 1];
		// Positions of discovered servers shift as they come and go: only their id names them.
		return index >= 1 && server && !server.discovered ? index : null;
	}
	const index = config.Servers.findIndex((s) => s.discovered?.id === key);
	return index >= 0 ? index + 1 : null;
}

/** `config` with the account of the discovered server at `index` read from its Secret. */
export async function withAccount(config: AppConfig, index: number): Promise<AppConfig> {
	const server = config.Servers[index - 1];
	const discovery = discoveryFor(config);
	if (!server?.discovered || !discovery) return config;
	const account = await discovery.credentials(server);
	const Servers = [...config.Servers];
	Servers[index - 1] = { ...server, ...account };
	return { ...config, Servers };
}
