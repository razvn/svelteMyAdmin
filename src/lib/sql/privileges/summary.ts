/** How a set of privileges is summarized in the account overview (Privileges::extractPrivInfo). */
import { allPrivilegeNames, isDynamicPrivilege } from './catalogue.ts';
import type { PrivServer, Scope } from './types.ts';

export interface PrivilegeSummary {
	/** `usage`: no privileges; `all`: every static privilege (GRANT excluded); `list`: explicit list. */
	kind: 'usage' | 'all' | 'list';
	/** Names to display: ['USAGE'], ['ALL PRIVILEGES'] or the list. */
	items: string[];
	/** Dynamic privileges on top (MySQL 8), shown collapsed. */
	dynamic: string[];
}

/** USAGE / ALL PRIVILEGES / the list of privileges, dynamic ones reported separately. */
export function summarizePrivileges(
	privileges: readonly string[],
	scope: Scope,
	server: PrivServer
): PrivilegeSummary {
	const dynamic = privileges.filter(isDynamicPrivilege);
	const stat = privileges.filter((p) => !isDynamicPrivilege(p));
	if (stat.length === 0 && dynamic.length === 0) {
		return { kind: 'usage', items: ['USAGE'], dynamic: [] };
	}
	const all = allPrivilegeNames(scope, server);
	if (all.length > 0 && all.every((p) => stat.includes(p))) {
		const extra = stat.filter((p) => !all.includes(p));
		return { kind: 'all', items: ['ALL PRIVILEGES', ...extra], dynamic };
	}
	return { kind: 'list', items: stat, dynamic };
}
