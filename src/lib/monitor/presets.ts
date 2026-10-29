/**
 * Default chart grid and preset charts (js/src/server/status/monitor.js `defaultChartGrid` / `presetCharts`).
 * System charts (CPU / memory / swap) are intentionally absent: phpMyAdmin reads them from the web host
 * and only offers them when the database runs on the same machine, which this app cannot assume.
 */
import {
	REFRESH_RATES,
	SettingsSchema,
	type ChartDef,
	type DataPoint,
	type MonitorSettings,
	type SeriesDef
} from './types.ts';

const status = (name: string): DataPoint => ({ type: 'statusvar', name });
const diff = (label: string, name: string, divisor = 1): SeriesDef => ({
	label,
	points: [status(name)],
	display: 'differential',
	divisor
});
const abs = (label: string, name: string, divisor = 1): SeriesDef => ({
	label,
	points: [status(name)],
	display: 'absolute',
	divisor
});

export interface Preset {
	key: string;
	label: string;
	chart: Omit<ChartDef, 'id'>;
}

export const PRESETS: Preset[] = [
	{
		key: 'questions',
		label: 'Questions',
		chart: { title: 'Questions', unit: '/s', series: [diff('Questions', 'Questions')] }
	},
	{
		key: 'connections',
		label: 'Connections / Processes',
		chart: {
			title: 'Connections / Processes',
			unit: '',
			series: [
				diff('Connections /s', 'Connections'),
				{
					label: 'Processes',
					points: [{ type: 'proc', name: 'processes' }],
					display: 'absolute',
					divisor: 1
				}
			]
		}
	},
	{
		key: 'traffic',
		label: 'Traffic',
		chart: {
			title: 'Traffic',
			unit: 'KiB/s',
			series: [
				diff('Bytes sent', 'Bytes_sent', 1024),
				diff('Bytes received', 'Bytes_received', 1024)
			]
		}
	},
	{
		key: 'threads',
		label: 'Threads',
		chart: {
			title: 'Threads',
			unit: '',
			series: [abs('Connected', 'Threads_connected'), abs('Running', 'Threads_running')]
		}
	},
	{
		key: 'innodb_buffer_pool',
		label: 'InnoDB buffer pool',
		chart: {
			title: 'InnoDB buffer pool',
			unit: '/s',
			series: [
				diff('Read requests', 'Innodb_buffer_pool_read_requests'),
				diff('Disk reads', 'Innodb_buffer_pool_reads')
			]
		}
	},
	{
		key: 'innodb_pages',
		label: 'InnoDB buffer pool pages',
		chart: {
			title: 'InnoDB buffer pool pages',
			unit: 'pages',
			series: [
				abs('Data pages', 'Innodb_buffer_pool_pages_data'),
				abs('Free pages', 'Innodb_buffer_pool_pages_free')
			]
		}
	},
	{
		key: 'table_locks',
		label: 'Table locks',
		chart: {
			title: 'Table locks',
			unit: '/s',
			series: [diff('Immediate', 'Table_locks_immediate'), diff('Waited', 'Table_locks_waited')]
		}
	},
	{
		key: 'handler_read',
		label: 'Handler read',
		chart: {
			title: 'Handler read',
			unit: '/s',
			series: [
				diff('Handler_read_key', 'Handler_read_key'),
				diff('Handler_read_next', 'Handler_read_next'),
				diff('Handler_read_rnd', 'Handler_read_rnd'),
				diff('Handler_read_rnd_next', 'Handler_read_rnd_next')
			]
		}
	},
	{
		key: 'slow_queries',
		label: 'Slow queries',
		chart: { title: 'Slow queries', unit: '/s', series: [diff('Slow queries', 'Slow_queries')] }
	},
	{
		key: 'qce',
		label: 'Query cache efficiency (MariaDB / MySQL < 8)',
		chart: {
			title: 'Query cache efficiency',
			unit: '%',
			series: [
				{
					label: 'Query cache efficiency',
					points: [status('Qcache_hits'), status('Com_select')],
					display: 'differential',
					divisor: 1,
					transform: 'qce'
				}
			]
		}
	},
	{
		key: 'qcu',
		label: 'Query cache usage (MariaDB / MySQL < 8)',
		chart: {
			title: 'Query cache usage',
			unit: '%',
			series: [
				{
					label: 'Query cache used',
					points: [status('Qcache_free_memory'), { type: 'servervar', name: 'query_cache_size' }],
					display: 'absolute',
					divisor: 1,
					transform: 'qcu'
				}
			]
		}
	}
];

/** Keys of the charts shown the first time (a subset of PRESETS, as in phpMyAdmin c0..c2 plus engine charts). */
export const DEFAULT_PRESET_KEYS = [
	'questions',
	'connections',
	'traffic',
	'innodb_buffer_pool',
	'table_locks',
	'handler_read'
];

export function chartFromPreset(key: string, id: string): ChartDef | null {
	const p = PRESETS.find((x) => x.key === key);
	return p ? { id, ...p.chart } : null;
}

export function defaultCharts(): ChartDef[] {
	return DEFAULT_PRESET_KEYS.map((k) => chartFromPreset(k, k)!);
}

export const DEFAULT_SETTINGS: MonitorSettings = {
	charts: defaultCharts(),
	columns: 3,
	refresh: 5
};

export const STORAGE_KEY = 'monitor_settings';

/** Settings from a stored JSON string; anything invalid falls back to the defaults. */
export function parseSettings(raw: string | null): MonitorSettings {
	if (!raw) return structuredClone(DEFAULT_SETTINGS);
	try {
		const parsed = SettingsSchema.safeParse(JSON.parse(raw));
		if (parsed.success) return parsed.data;
	} catch {
		/* corrupt JSON */
	}
	return structuredClone(DEFAULT_SETTINGS);
}

export function loadSettings(storage: Pick<Storage, 'getItem'> | undefined): MonitorSettings {
	try {
		return parseSettings(storage?.getItem(STORAGE_KEY) ?? null);
	} catch {
		return structuredClone(DEFAULT_SETTINGS);
	}
}

export function saveSettings(
	storage: Pick<Storage, 'setItem'> | undefined,
	settings: MonitorSettings
): void {
	try {
		storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
	} catch {
		/* storage unavailable or full: settings simply are not persisted */
	}
}

export function refreshLabel(seconds: number): string {
	return seconds >= 60 ? `${seconds / 60} min` : `${seconds} s`;
}

export { REFRESH_RATES };

/** Unique chart id for a new chart. */
export function newChartId(existing: ChartDef[], base = 'chart'): string {
	const ids = new Set(existing.map((c) => c.id));
	let i = existing.length + 1;
	while (ids.has(`${base}${i}`)) i++;
	return `${base}${i}`;
}
