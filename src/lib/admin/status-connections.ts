/**
 * Rows of the "Connections" table on the server status page
 * (Controllers/Server/Status/StatusController.php::getConnectionsInfo).
 * Pure: no framework imports.
 */
import { formatNumber, formatSi } from '#lib/format.ts';

export interface ConnectionsInput {
	uptime: number;
	connections: number;
	maxUsedConnections: number;
	abortedConnects: number;
	abortedClients: number;
}

export interface ConnectionRow {
	name: string;
	/** Absolute count: plain grouped integer, e.g. "9" or "1,234". */
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
			name: 'Max. concurrent connections',
			number: formatNumber(input.maxUsedConnections),
			perHour: '---',
			percentage: '---'
		},
		{
			name: 'Failed attempts',
			number: formatNumber(input.abortedConnects),
			perHour: perHour(input.abortedConnects),
			percentage: share(input.abortedConnects, input.connections)
		},
		{
			name: 'Aborted',
			number: formatNumber(input.abortedClients),
			perHour: perHour(input.abortedClients),
			percentage: share(input.abortedClients, input.connections)
		},
		{
			name: 'Total',
			number: formatNumber(input.connections),
			perHour: si(input.connections * hourFactor, 4, 2),
			percentage: '100.00%'
		}
	];
}
