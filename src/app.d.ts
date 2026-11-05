// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { AppConfig, ServerConfig } from '#lib/server/config/schema.ts';
import type { SessionInfo } from '#lib/server/auth/index.ts';
import type { Connection } from '#lib/server/db/connection.ts';
import type { DatabaseInterface } from '#lib/server/db/dbi.ts';

declare global {
	namespace App {
		interface Locals {
			/** Resolved interface language code (see `#lib/i18n/resolve.ts`). */
			locale: string;
			/** Translation functions for `locale`, for server code: `locals.i18n.t('...')`. */
			i18n: import('#lib/i18n/translator.ts').Translator;
			/** Loaded configuration (shared, read-only). */
			config: AppConfig;
			/** 1-based index of the active server in `config.Servers` (this request's list). */
			serverIndex: number;
			/**
			 * Stable name of the active server across requests: the position for configured servers,
			 * `k8s:<namespace>/<service>` for discovered ones. Key anything kept beyond the request with it.
			 */
			serverId: string;
			/** `signon` only: the person the SSO proxy authenticated (with groups); else null. */
			identity: import('#lib/server/auth/plugins/types.ts').Identity | null;
			/** Active server definition (host/port reflect an arbitrary-server login). */
			server: ServerConfig;
			/** Resolved client address (honours TrustedProxies), null if unknown. */
			clientIp: string | null;
			/** Direct TCP peer of the request (not resolved through TrustedProxies), null if unknown. */
			peerAddress: string | null;
			/** Non-secret facts about the logged-in user; null when not authenticated. */
			session: SessionInfo | null;
			/** Password accepted but the second factor is still pending (only `/login/2fa` serves it). */
			twoFactorPending: SessionInfo | null;
			/**
			 * Lazily opened connection using the session credentials. Awaiting it opens the
			 * connection on first use; it is closed automatically after the response.
			 */
			readonly db: Promise<Connection>;
			/** Audit log of the request (who is acting is filled in); a no-op when `AuditLog` is off. */
			audit: import('#lib/server/audit/index.ts').RequestAudit;
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
