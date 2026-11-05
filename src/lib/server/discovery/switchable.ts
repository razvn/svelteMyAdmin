/**
 * The servers offered by the server switcher. A signon person only sees the signon servers whose
 * Kubernetes RBAC lets them in (with dozens of review namespaces, the others are noise and would
 * only answer 403). Other servers are listed as configured.
 */
import { serverLabel } from '../auth/index.ts';
import { authorizeIdentity } from '../auth/signon/kubernetes.ts';
import type { Identity } from '../auth/plugins/types';
import type { AppConfig, ServerConfig } from '../config/schema';
import { serverKey } from './index.ts';

export interface SwitchableServer {
	/** Form value of the switcher: `serverKey` (position or discovery id). */
	key: string;
	/** 1-based position in this request's list (for the shared picker filter). */
	index: number;
	label: string;
	host: string;
	port: number;
	auth: ServerConfig['auth_type'];
}

type Authorize = typeof authorizeIdentity;

/**
 * The first signon server (in list order, `except` skipped) the person may use: one without an RBAC
 * check, or whose check allows them. Null when there is none. Checks that fail count as refusals.
 */
export async function firstAllowedServer(
	config: Pick<AppConfig, 'Servers'>,
	identity: Identity,
	except: number,
	authorize: Authorize = authorizeIdentity
): Promise<number | null> {
	const allowed = await Promise.all(
		config.Servers.map(async (server, i) => {
			if (i + 1 === except || server.auth_type !== 'signon') return false;
			const rbac = server.Signon?.authorize;
			if (!rbac) return true;
			const decision = await authorize(identity, rbac).catch(() => null);
			return decision?.allowed === true;
		})
	);
	const index = allowed.indexOf(true);
	return index >= 0 ? index + 1 : null;
}

export async function switchableServers(
	locals: Pick<App.Locals, 'config' | 'serverIndex' | 'identity'>,
	authorize: Authorize = authorizeIdentity
): Promise<SwitchableServer[]> {
	const { config, serverIndex, identity } = locals;
	const listed = await Promise.all(
		config.Servers.map(async (server, i) => {
			const index = i + 1;
			const rbac = server.auth_type === 'signon' ? server.Signon?.authorize : undefined;
			if (rbac && identity && index !== serverIndex) {
				// Same cached review as the request itself would make; unknown = not offered.
				const decision = await authorize(identity, rbac).catch(() => null);
				if (!decision?.allowed) return null;
			}
			return {
				key: serverKey(config, index),
				index,
				label: serverLabel(server),
				host: server.host,
				port: server.port,
				auth: server.auth_type
			};
		})
	);
	return listed.filter((s) => s !== null);
}
