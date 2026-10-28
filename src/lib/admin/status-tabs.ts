/** Secondary navigation of the Status page (templates/server/status/base.twig). */
export interface StatusSubTab {
	id: string;
	label: string;
	/** Path below /server/status ('' = the page itself). */
	path: string;
}

export const STATUS_SUB_TABS: StatusSubTab[] = [
	{ id: 'server', label: 'Server', path: '' },
	{ id: 'processes', label: 'Processes', path: 'processes' },
	{ id: 'queries', label: 'Query statistics', path: 'queries' },
	{ id: 'variables', label: 'All status variables', path: 'variables' },
	{ id: 'monitor', label: 'Monitor', path: 'monitor' },
	{ id: 'advisor', label: 'Advisor', path: 'advisor' }
];

/** Sub tab id for a pathname below /server/status. */
export function activeStatusSubTab(pathname: string): string {
	const rest = pathname.replace(/^\/server\/status\/?/, '').replace(/\/+$/, '');
	return (
		STATUS_SUB_TABS.find((t) => t.path !== '' && t.path === rest.split('/')[0])?.id ?? 'server'
	);
}
