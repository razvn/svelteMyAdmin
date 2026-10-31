import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { configSchema, serverSchema, type AppConfig } from './schema';

export class ConfigError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = 'ConfigError';
	}
}

/** Path of the config file: `$SMA_CONFIG` or `<cwd>/config.json`. */
export function getConfigPath(env: NodeJS.ProcessEnv = process.env): string {
	return resolve(env.SMA_CONFIG || 'config.json');
}

/**
 * Validate a raw (already JSON-parsed) config object and merge it with the
 * phpMyAdmin defaults. When no server is configured a default one is added,
 * like phpMyAdmin does.
 */
export function parseConfig(
	raw: unknown = {},
	baseDir: string = dirname(getConfigPath())
): AppConfig {
	const result = configSchema.safeParse(raw ?? {});
	if (!result.success) {
		const details = result.error.issues
			.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
			.join('; ');
		throw new ConfigError(`Invalid configuration: ${details}`);
	}
	const config = result.data;
	if (config.Servers.length === 0) {
		config.Servers = [serverSchema.parse({})];
	}
	if (config.ServerDefault > config.Servers.length) {
		throw new ConfigError(
			`Invalid configuration: ServerDefault (${config.ServerDefault}) refers to a missing server`
		);
	}
	// Servers without a pmadb use the SQLite configuration storage when one is configured.
	if (config.ConfigStorage) {
		const path = resolve(baseDir, config.ConfigStorage.path);
		for (const server of config.Servers) {
			if (!server.pmadb && server.ConfigStorage !== false) server.sqlite_storage = path;
		}
	}
	return config;
}

/**
 * Load the configuration from disk. A missing file yields the defaults;
 * an unreadable or malformed file throws a ConfigError.
 */
export function loadConfig(path: string = getConfigPath()): AppConfig {
	if (!existsSync(path)) return parseConfig({});
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, 'utf8'));
	} catch (e) {
		throw new ConfigError(`Cannot read configuration ${path}: ${(e as Error).message}`, {
			cause: e
		});
	}
	return parseConfig(raw, dirname(resolve(path)));
}

let cached: AppConfig | undefined;

/** Cached config for the running server process. */
export function getConfig(): AppConfig {
	return (cached ??= loadConfig());
}

/** Test helper / hot reload. */
export function resetConfigCache(): void {
	cached = undefined;
}
