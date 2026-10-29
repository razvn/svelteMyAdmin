/** Tracking report: which log(s) to show and how the filter form maps to entries. */
import { filterEntries, type FilteredEntry, type LogEntry, type ReportFilter } from './analyse.ts';

export const LOG_TYPES = ['schema', 'data', 'schema_and_data'] as const;
export type LogType = (typeof LOG_TYPES)[number];

export const parseLogType = (v: string | null | undefined): LogType =>
	LOG_TYPES.includes(v as LogType) ? (v as LogType) : 'schema_and_data';

/** Tracking::getEntries: filtered DDL entries followed by filtered DML entries. */
export function reportEntries(
	ddlog: LogEntry[],
	dmlog: LogEntry[],
	logtype: LogType,
	filter: ReportFilter
): FilteredEntry[] {
	return [
		...(logtype !== 'data' ? filterEntries(ddlog, filter) : []),
		...(logtype !== 'schema' ? filterEntries(dmlog, filter) : [])
	];
}

/** The statement types offered when creating a version (Tracking::getTrackingSet). */
export const VERSION_STATEMENTS = {
	'Data definition': [
		'CREATE TABLE',
		'ALTER TABLE',
		'RENAME TABLE',
		'DROP TABLE',
		'CREATE VIEW',
		'ALTER VIEW',
		'DROP VIEW',
		'CREATE INDEX',
		'DROP INDEX'
	],
	'Data manipulation': ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']
} as const;

/** Filter / report parameters shared by the page, the download and the execute action. */
export function reportParams(get: (k: string) => string | null | undefined) {
	return {
		logtype: parseLogType(get('logtype')),
		from: (get('date_from') ?? '').trim(),
		to: (get('date_to') ?? '').trim(),
		users: (get('users') ?? '*').trim() || '*'
	};
}
