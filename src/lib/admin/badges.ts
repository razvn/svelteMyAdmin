/**
 * Badge variants for engine support and plugin status. Shared by the server pages and the browser
 * components, so it lives outside `src/lib/server/`.
 */

export type SupportVariant = 'default' | 'secondary' | 'outline' | 'destructive';

/** `SHOW ENGINES` support column -> badge variant. */
export function engineSupportVariant(support: string): SupportVariant {
	switch (support) {
		case 'DEFAULT':
			return 'default';
		case 'YES':
			return 'secondary';
		case 'DISABLED':
			return 'destructive';
		default:
			return 'outline';
	}
}

export type PluginStatusVariant = 'secondary' | 'destructive';

/** Active plugins are neutral, anything else (INACTIVE, DISABLED, DELETING, ...) stands out. */
export function pluginStatusVariant(status: string): PluginStatusVariant {
	return status === 'ACTIVE' ? 'secondary' : 'destructive';
}
