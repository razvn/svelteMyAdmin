/** Monitor chart model (js/src/server/status/monitor.js: chart grid / presetCharts). */
import { z } from 'zod';

/** `proc` = number of rows of SHOW PROCESSLIST. */
export const POINT_TYPES = ['statusvar', 'servervar', 'proc'] as const;

export const DataPointSchema = z.object({
	type: z.enum(POINT_TYPES),
	// Same restriction as Monitor.php (`/[^a-zA-Z_]+/` is rejected), digits allowed for e.g. Com_*.
	name: z.string().regex(/^[A-Za-z0-9_]{1,64}$/)
});
export type DataPoint = z.infer<typeof DataPointSchema>;

export const SeriesSchema = z.object({
	label: z.string().min(1).max(80),
	points: z.array(DataPointSchema).min(1).max(4),
	/** `differential` = change per second, `absolute` = the raw value. */
	display: z.enum(['differential', 'absolute']),
	divisor: z.number().finite().positive(),
	/** Combines the points of a series (the `transformFn` of PHP presets). */
	transform: z.enum(['qce', 'qcu']).optional()
});
export type SeriesDef = z.infer<typeof SeriesSchema>;

export const ChartSchema = z.object({
	id: z.string().min(1).max(40),
	title: z.string().min(1).max(80),
	unit: z.string().max(20),
	series: z.array(SeriesSchema).min(1).max(8)
});
export type ChartDef = z.infer<typeof ChartSchema>;

export const REFRESH_RATES = [2, 5, 10, 20, 30, 60, 120, 300, 600] as const;

export const SettingsSchema = z.object({
	charts: z.array(ChartSchema).max(24),
	columns: z.union([z.literal(2), z.literal(3), z.literal(4)]),
	/** Seconds between samples. */
	refresh: z.number().refine((n) => (REFRESH_RATES as readonly number[]).includes(n))
});
export type MonitorSettings = z.infer<typeof SettingsSchema>;

/** Raw values of one poll, keyed by `pointKey()`. null = not available on this server. */
export type RawSample = Record<string, number | null>;

export const pointKey = (p: DataPoint): string => `${p.type}:${p.name}`;

/** Response of POST /server/status/monitor/data. */
export interface MonitorDataResponse {
	/** Server time in ms. */
	x: number;
	values: Record<string, string | number | null>;
}
