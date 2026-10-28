/** Client-safe constants for events (no imports). */
export const EVENT_TYPES = ['ONE TIME', 'RECURRING'] as const;
export type EventType = (typeof EVENT_TYPES)[number];

export const EVENT_STATUSES = ['ENABLED', 'DISABLED', 'SLAVESIDE_DISABLED'] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** Status as written in CREATE EVENT. */
export const EVENT_STATUS_SQL: Record<EventStatus, string> = {
	ENABLED: 'ENABLE',
	DISABLED: 'DISABLE',
	SLAVESIDE_DISABLED: 'DISABLE ON SLAVE'
};

export const EVENT_INTERVALS = [
	'YEAR',
	'QUARTER',
	'MONTH',
	'DAY',
	'HOUR',
	'MINUTE',
	'WEEK',
	'SECOND',
	'YEAR_MONTH',
	'DAY_HOUR',
	'DAY_MINUTE',
	'DAY_SECOND',
	'HOUR_MINUTE',
	'HOUR_SECOND',
	'MINUTE_SECOND'
] as const;
