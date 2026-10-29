import { N_ } from '#lib/i18n/index.ts';

/** Secondary navigation of the Status page (templates/server/status/base.twig). */
export interface StatusSubTab {
	id: string;
	/** English msgid: translate with `t(label)`. */
	label: string;
	/** Path below /server/status ('' = the page itself). */
	path: string;
}

export const STATUS_SUB_TABS: StatusSubTab[] = [
	{ id: 'server', label: N_('Server'), path: '' },
	{ id: 'processes', label: N_('Processes'), path: 'processes' },
	{ id: 'queries', label: N_('Query statistics'), path: 'queries' },
	{ id: 'variables', label: N_('All status variables'), path: 'variables' },
	{ id: 'monitor', label: N_('Monitor'), path: 'monitor' },
	{ id: 'advisor', label: N_('Advisor'), path: 'advisor' }
];

/** Sub tab id for a pathname below /server/status. */
export function activeStatusSubTab(pathname: string): string {
	const rest = pathname.replace(/^\/server\/status\/?/, '').replace(/\/+$/, '');
	return (
		STATUS_SUB_TABS.find((t) => t.path !== '' && t.path === rest.split('/')[0])?.id ?? 'server'
	);
}
