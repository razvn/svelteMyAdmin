/**
 * Default chart grid and preset charts (js/src/server/status/monitor.js `defaultChartGrid` / `presetCharts`).
 * System charts (CPU / memory / swap) are intentionally absent: phpMyAdmin reads them from the web host
 * and only offers them when the database runs on the same machine, which this app cannot assume.
 */
import { N_ } from '#lib/i18n/index.ts';
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
		label: N_('Questions'),
		chart: { title: N_('Questions'), unit: '/s', series: [diff(N_('Questions'), 'Questions')] }
	},
	{
		key: 'connections',
		label: N_('Connections / Processes'),
		chart: {
			title: N_('Connections / Processes'),
			unit: '',
			series: [
				diff(N_('Connections /s'), 'Connections'),
				{
					label: N_('Processes'),
					points: [{ type: 'proc', name: 'processes' }],
					display: 'absolute',
					divisor: 1
				}
			]
		}
	},
	{
		key: 'traffic',
		label: N_('Traffic'),
		chart: {
			title: N_('Traffic'),
			unit: 'KiB/s',
			series: [
				diff(N_('Bytes sent'), 'Bytes_sent', 1024),
				diff(N_('Bytes received'), 'Bytes_received', 1024)
			]
		}
	},
	{
		key: 'threads',
		label: N_('Threads'),
		chart: {
			title: N_('Threads'),
			unit: '',
			series: [abs(N_('Connected'), 'Threads_connected'), abs(N_('Running'), 'Threads_running')]
		}
	},
	{
		key: 'innodb_buffer_pool',
		label: N_('InnoDB buffer pool'),
		chart: {
			title: N_('InnoDB buffer pool'),
			unit: '/s',
			series: [
				diff(N_('Read requests'), 'Innodb_buffer_pool_read_requests'),
				diff(N_('Disk reads'), 'Innodb_buffer_pool_reads')
			]
		}
	},
	{
		key: 'innodb_pages',
		label: N_('InnoDB buffer pool pages'),
		chart: {
			title: N_('InnoDB buffer pool pages'),
			unit: 'pages',
			series: [
				abs(N_('Data pages'), 'Innodb_buffer_pool_pages_data'),
				abs(N_('Free pages'), 'Innodb_buffer_pool_pages_free')
			]
		}
	},
	{
		key: 'table_locks',
		label: N_('Table locks'),
		chart: {
			title: N_('Table locks'),
			unit: '/s',
			series: [
				diff(N_('Immediate'), 'Table_locks_immediate'),
				diff(N_('Waited'), 'Table_locks_waited')
			]
		}
	},
	{
		key: 'handler_read',
		label: N_('Handler read'),
		chart: {
			title: N_('Handler read'),
			unit: '/s',
			series: [
				diff(N_('Handler_read_key'), 'Handler_read_key'),
				diff(N_('Handler_read_next'), 'Handler_read_next'),
				diff(N_('Handler_read_rnd'), 'Handler_read_rnd'),
				diff(N_('Handler_read_rnd_next'), 'Handler_read_rnd_next')
			]
		}
	},
	{
		key: 'slow_queries',
		label: N_('Slow queries'),
		chart: {
			title: N_('Slow queries'),
			unit: '/s',
			series: [diff(N_('Slow queries'), 'Slow_queries')]
		}
	},
	{
		key: 'qce',
		label: N_('Query cache efficiency (MariaDB / MySQL < 8)'),
		chart: {
			title: N_('Query cache efficiency'),
			unit: '%',
			series: [
				{
					label: N_('Query cache efficiency'),
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
		label: N_('Query cache usage (MariaDB / MySQL < 8)'),
		chart: {
			title: N_('Query cache usage'),
			unit: '%',
			series: [
				{
					label: N_('Query cache used'),
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

export function refreshLabel(
	seconds: number,
	t: (msgid: string, params?: Record<string, number>) => string
): string {
	return seconds >= 60 ? t('{n} min', { n: seconds / 60 }) : t('{n} s', { n: seconds });
}

export { REFRESH_RATES };

/** Unique chart id for a new chart. */
export function newChartId(existing: ChartDef[], base = 'chart'): string {
	const ids = new Set(existing.map((c) => c.id));
	let i = existing.length + 1;
	while (ids.has(`${base}${i}`)) i++;
	return `${base}${i}`;
}
