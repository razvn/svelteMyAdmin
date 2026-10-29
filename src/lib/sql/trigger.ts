/**
 * Pure SQL builders for triggers (Database/Triggers.php getQueryFromRequest).
 */
import { escapeQualified } from '#lib/server/db/escape.ts';
import { buildDefinerClause } from './definer.ts';
import {
	TRIGGER_EVENTS,
	TRIGGER_TIMINGS,
	type TriggerEvent,
	type TriggerTiming
} from './trigger-types.ts';
import { SOURCE_TRANSLATOR, type Translator } from '#lib/i18n/translator.ts';

export * from './trigger-types.ts';

export interface TriggerDef {
	name: string;
	table: string;
	timing: TriggerTiming;
	event: TriggerEvent;
	definition: string;
	definer: string;
}

export function buildCreateTrigger(
	db: string,
	def: TriggerDef,
	tr: Translator = SOURCE_TRANSLATOR
): { sql: string; errors: string[] } {
	const errors: string[] = [];
	let sql = 'CREATE ';
	const definer = buildDefinerClause(def.definer, tr);
	if (definer.error) errors.push(definer.error);
	sql += definer.clause;
	sql += 'TRIGGER ';
	if (def.name.trim() === '') errors.push(tr.t('You must provide a trigger name'));
	else sql += escapeQualified(db, def.name) + ' ';
	if (!(TRIGGER_TIMINGS as readonly string[]).includes(def.timing)) {
		errors.push(tr.t('You must provide a valid timing for the trigger'));
	} else sql += def.timing + ' ';
	if (!(TRIGGER_EVENTS as readonly string[]).includes(def.event)) {
		errors.push(tr.t('You must provide a valid event for the trigger'));
	} else sql += def.event + ' ';
	if (def.table.trim() === '') errors.push(tr.t('You must provide a valid table name'));
	else sql += 'ON ' + escapeQualified(db, def.table) + ' FOR EACH ROW ';
	if (def.definition.trim() === '') errors.push(tr.t('You must provide a trigger definition.'));
	else sql += def.definition;
	return { sql, errors };
}

export function buildDropTrigger(db: string, name: string): string {
	return `DROP TRIGGER ${escapeQualified(db, name)}`;
}

export function buildShowCreateTrigger(db: string, name: string): string {
	return `SHOW CREATE TRIGGER ${escapeQualified(db, name)}`;
}
