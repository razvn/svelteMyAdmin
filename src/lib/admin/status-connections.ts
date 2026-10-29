/**
 * Rows of the "Connections" table on the server status page
 * (Controllers/Server/Status/StatusController.php::getConnectionsInfo).
 * Pure: no framework imports.
 */
import { formatSi } from '#lib/format.ts';
import { N_ } from '#lib/i18n/index.ts';

export interface ConnectionsInput {
	uptime: number;
	connections: number;
	maxUsedConnections: number;
	abortedConnects: number;
	abortedClients: number;
}

export interface ConnectionRow {
	/** English msgid: translate with `t(name)`. */
	name: string;
	/** Absolute count, formatted exactly as PHP getConnectionsInfo does (e.g. "9", "1,234", "12.3 k"). */
	number: string;
	/** "ø per hour". */
	perHour: string;
	/** Share of all connections. */
	percentage: string;
}

/** formatSi without the trailing blank that PHP's empty SI unit leaves behind. */
const si = (value: number, digitsLeft: number, digitsRight: number, onlyDown = false) =>
	formatSi(value, digitsLeft, digitsRight, onlyDown).trim();

/** Share of `part` in `total` as "x.xx%" (PHP shows "---" when there is no total). */
function share(part: number, total: number): string {
	return total > 0 ? `${si((part * 100) / total, 0, 2, true)}%` : '---';
}

export function connectionRows(input: ConnectionsInput): ConnectionRow[] {
	const hourFactor = input.uptime > 0 ? 3600 / input.uptime : 1;
	const perHour = (n: number) => si(n * hourFactor, 4, 2, true);
	return [
		{
			name: N_('Max. concurrent connections'),
			number: si(input.maxUsedConnections, 0, 0),
			perHour: '---',
			percentage: '---'
		},
		{
			name: N_('Failed attempts'),
			number: si(input.abortedConnects, 4, 1, true),
			perHour: perHour(input.abortedConnects),
			percentage: share(input.abortedConnects, input.connections)
		},
		{
			name: N_('Aborted'),
			number: si(input.abortedClients, 4, 1, true),
			perHour: perHour(input.abortedClients),
			percentage: share(input.abortedClients, input.connections)
		},
		{
			name: N_('Total'),
			number: si(input.connections, 4, 0),
			perHour: si(input.connections * hourFactor, 4, 2),
			percentage: '100.00%'
		}
	];
}
