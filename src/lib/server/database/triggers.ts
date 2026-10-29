/**
 * Database > Triggers and table > Triggers (Controllers/Database/TriggersController.php,
 * Controllers/Table/TriggersController.php, Database/Triggers.php). Every function takes an optional
 * table filter so the table-level tab can reuse them.
 */
import type { Connection } from '../db/connection';
import { definerToInput } from '#lib/sql/definer.ts';
import {
	buildCreateTrigger,
	buildDropTrigger,
	buildShowCreateTrigger,
	type TriggerDef,
	type TriggerEvent,
	type TriggerTiming
} from '#lib/sql/trigger.ts';
import { SOURCE_TRANSLATOR, type Translator } from '#lib/i18n/translator.ts';
import { createOrReplace, rows, showCreate, sqlErrorMessage, str, type SaveResult } from './common';

export interface TriggerListItem {
	name: string;
	table: string;
	event: string;
	timing: string;
	definer: string;
}

export async function listTriggers(
	conn: Connection,
	db: string,
	table?: string
): Promise<TriggerListItem[]> {
	const r = await rows(
		conn,
		'SELECT TRIGGER_NAME AS name, EVENT_OBJECT_TABLE AS table_name, EVENT_MANIPULATION AS event, ' +
			'ACTION_TIMING AS timing, DEFINER AS definer FROM information_schema.TRIGGERS ' +
			'WHERE TRIGGER_SCHEMA = ?' +
			(table === undefined ? '' : ' AND EVENT_OBJECT_TABLE = ?') +
			' ORDER BY TRIGGER_NAME',
		table === undefined ? [db] : [db, table]
	);
	return r.map((x) => ({
		name: str(x.name),
		table: str(x.table_name),
		event: str(x.event),
		timing: str(x.timing),
		definer: str(x.definer)
	}));
}

export async function getTrigger(
	conn: Connection,
	db: string,
	name: string,
	table?: string
): Promise<TriggerDef | null> {
	const [x] = await rows(
		conn,
		'SELECT TRIGGER_NAME AS name, EVENT_OBJECT_TABLE AS table_name, EVENT_MANIPULATION AS event, ' +
			'ACTION_TIMING AS timing, DEFINER AS definer, ACTION_STATEMENT AS body ' +
			'FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = ? AND TRIGGER_NAME = ?' +
			(table === undefined ? '' : ' AND EVENT_OBJECT_TABLE = ?'),
		table === undefined ? [db, name] : [db, name, table]
	);
	if (!x) return null;
	return {
		name: str(x.name),
		table: str(x.table_name),
		timing: str(x.timing) as TriggerTiming,
		event: str(x.event) as TriggerEvent,
		definition: str(x.body),
		definer: definerToInput(str(x.definer))
	};
}

export const exportTrigger = (conn: Connection, db: string, name: string) =>
	showCreate(conn, buildShowCreateTrigger(db, name), 'SQL Original Statement');

export async function dropTrigger(
	conn: Connection,
	db: string,
	name: string
): Promise<{ ok: boolean; error?: string; query: string }> {
	const query = buildDropTrigger(db, name);
	try {
		await conn.query(query);
		return { ok: true, query };
	} catch (err) {
		return { ok: false, error: sqlErrorMessage(err), query };
	}
}

export async function saveTrigger(
	conn: Connection,
	db: string,
	def: TriggerDef,
	originalName: string | null,
	tr: Translator = SOURCE_TRANSLATOR
): Promise<SaveResult> {
	const built = buildCreateTrigger(db, def, tr);
	if (built.errors.length > 0) return { ok: false, errors: built.errors, queries: [] };
	if (originalName === null) return createOrReplace(conn, db, { createSql: built.sql, tr });
	let originalSql: string | null;
	try {
		originalSql = await exportTrigger(conn, db, originalName);
	} catch (err) {
		return { ok: false, errors: [sqlErrorMessage(err)], queries: [] };
	}
	return createOrReplace(conn, db, {
		createSql: built.sql,
		dropSql: buildDropTrigger(db, originalName),
		originalSql,
		tr
	});
}
