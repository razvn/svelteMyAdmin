/**
 * Pure SQL builders for events (Database/Events.php getQueryFromRequest).
 */
import { escapeQualified, escapeString } from '#lib/server/db/escape.ts';
import { buildDefinerClause } from './definer.ts';
import {
	EVENT_INTERVALS,
	EVENT_STATUS_SQL,
	type EventStatus,
	type EventType
} from './event-types.ts';

export * from './event-types.ts';

export interface EventDef {
	name: string;
	status: EventStatus;
	type: EventType;
	executeAt: string;
	intervalValue: string;
	intervalField: string;
	starts: string;
	ends: string;
	definition: string;
	preserve: boolean;
	definer: string;
	comment: string;
}

/** Interval expression: plain integer, or a quoted compound value such as '1-2' for YEAR_MONTH. */
function intervalExpr(value: string): string | null {
	const v = value.trim();
	if (/^\d+$/.test(v)) return String(parseInt(v, 10));
	if (/^[\d:. -]+$/.test(v)) return `'${escapeString(v)}'`;
	return null;
}

export function buildCreateEvent(db: string, def: EventDef): { sql: string; errors: string[] } {
	const errors: string[] = [];
	let sql = 'CREATE ';
	const definer = buildDefinerClause(def.definer);
	if (definer.error) errors.push(definer.error);
	sql += definer.clause;
	sql += 'EVENT ';
	if (def.name.trim() === '') errors.push('You must provide an event name!');
	else sql += escapeQualified(db, def.name) + ' ';

	sql += 'ON SCHEDULE ';
	if (def.type === 'RECURRING') {
		const expr = intervalExpr(def.intervalValue);
		if (expr !== null && (EVENT_INTERVALS as readonly string[]).includes(def.intervalField)) {
			sql += `EVERY ${expr} ${def.intervalField} `;
		} else errors.push('You must provide a valid interval value for the event.');
		if (def.starts.trim() !== '') sql += `STARTS '${escapeString(def.starts.trim())}' `;
		if (def.ends.trim() !== '') sql += `ENDS '${escapeString(def.ends.trim())}' `;
	} else if (def.type === 'ONE TIME') {
		if (def.executeAt.trim() !== '') sql += `AT '${escapeString(def.executeAt.trim())}' `;
		else errors.push('You must provide a valid execution time for the event.');
	} else {
		errors.push('You must provide a valid type for the event.');
	}

	sql += def.preserve ? 'ON COMPLETION PRESERVE ' : 'ON COMPLETION NOT PRESERVE ';
	if (def.status in EVENT_STATUS_SQL) sql += EVENT_STATUS_SQL[def.status] + ' ';
	if (def.comment !== '') sql += `COMMENT '${escapeString(def.comment)}' `;
	sql += 'DO ';
	if (def.definition.trim() === '') errors.push('You must provide an event definition.');
	else sql += def.definition;
	return { sql, errors };
}

export function buildDropEvent(db: string, name: string): string {
	return `DROP EVENT ${escapeQualified(db, name)}`;
}

export function buildShowCreateEvent(db: string, name: string): string {
	return `SHOW CREATE EVENT ${escapeQualified(db, name)}`;
}
