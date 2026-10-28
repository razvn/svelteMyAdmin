/**
 * Badge variants for engine support and plugin status. Shared by the server pages and the browser
 * components, so it lives outside `src/lib/server/`.
 */

export type SupportVariant = 'primary' | 'success' | 'muted' | 'destructive';

/** `SHOW ENGINES` support column -> badge variant. */
export function engineSupportVariant(support: string): SupportVariant {
	switch (support) {
		case 'DEFAULT':
			return 'primary';
		case 'YES':
			return 'success';
		case 'DISABLED':
			return 'destructive';
		default:
			return 'muted';
	}
}

export type PluginStatusVariant = 'success' | 'warning' | 'destructive';

/** Active plugins are green, DISABLED ones red, anything else (INACTIVE, DELETING, ...) amber. */
export function pluginStatusVariant(status: string): PluginStatusVariant {
	if (status === 'ACTIVE') return 'success';
	return status === 'DISABLED' ? 'destructive' : 'warning';
}

export type YesNoVariant = 'success' | 'muted';

/** YES / NO / NULL flags (transactions, XA, savepoints): YES is green, everything else grey. */
export function yesNoVariant(value: string | null | undefined): YesNoVariant {
	return value === 'YES' ? 'success' : 'muted';
}
