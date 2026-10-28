import type { ServerConfig } from '../config/schema';
import type { RuleFailure } from './errors';
import { isForbidden } from './ip-allow-deny';

/**
 * Port of AuthenticationPlugin::checkRules: AllowDeny, AllowRoot, AllowNoPassword.
 * Returns the failure kind, or null when the login is acceptable.
 */
export function checkRules(
	server: Pick<ServerConfig, 'AllowDeny' | 'AllowRoot' | 'AllowNoPassword'>,
	user: string,
	password: string,
	clientIp: string | null
): RuleFailure | null {
	if (server.AllowDeny && server.AllowDeny.order) {
		if (isForbidden(server.AllowDeny, { clientIp, username: user })) return 'allow-denied';
	}
	if (!server.AllowRoot && user === 'root') return 'root-denied';
	if (!server.AllowNoPassword && password === '') return 'empty-denied';
	return null;
}
