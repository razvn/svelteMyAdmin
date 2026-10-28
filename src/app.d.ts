// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { AppConfig, ServerConfig } from '#lib/server/config/schema.ts';
import type { SessionInfo } from '#lib/server/auth/index.ts';
import type { Connection } from '#lib/server/db/connection.ts';
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';

declare global {
	namespace App {
		interface Locals {
			/** Loaded configuration (shared, read-only). */
			config: AppConfig;
			/** 1-based index of the active server in `config.Servers`. */
			serverIndex: number;
			/** Active server definition (host/port reflect an arbitrary-server login). */
			server: ServerConfig;
			/** Resolved client address (honours TrustedProxies), null if unknown. */
			clientIp: string | null;
			/** Non-secret facts about the logged-in user; null when not authenticated. */
			session: SessionInfo | null;
			/**
			 * Lazily opened connection using the session credentials. Awaiting it opens the
			 * connection on first use; it is closed automatically after the response.
			 */
			readonly db: Promise<Connection>;
			/** DatabaseInterface bound to `db` and the active server. */
			readonly dbi: Promise<DatabaseInterface>;
		}
		// interface Error {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
