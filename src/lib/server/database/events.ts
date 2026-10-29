/**
 * Database > Events (Controllers/Database/EventsController.php, Database/Events.php).
 */
import type { Connection } from '../db/connection';
import { SOURCE_TRANSLATOR, type Translator } from '#lib/i18n/translator.ts';
import { definerToInput } from '#lib/sql/definer.ts';
import {
	buildCreateEvent,
	buildDropEvent,
	buildShowCreateEvent,
	type EventDef,
	type EventStatus,
	type EventType
} from '#lib/sql/event.ts';
import { createOrReplace, rows, showCreate, sqlErrorMessage, str, type SaveResult } from './common';

export interface EventListItem {
	name: string;
	status: string;
	type: string;
	executeAt: string | null;
	intervalValue: string | null;
	intervalField: string | null;
	starts: string | null;
	ends: string | null;
	definer: string;
	comment: string;
}

const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const EVENT_COLUMNS =
	'EVENT_NAME AS name, STATUS AS status, EVENT_TYPE AS type, CAST(EXECUTE_AT AS CHAR) AS execute_at, ' +
	'INTERVAL_VALUE AS interval_value, INTERVAL_FIELD AS interval_field, CAST(STARTS AS CHAR) AS starts, ' +
	'CAST(ENDS AS CHAR) AS ends, DEFINER AS definer, EVENT_COMMENT AS comment, ' +
	'EVENT_DEFINITION AS def, ON_COMPLETION AS on_completion';

export async function listEvents(conn: Connection, db: string): Promise<EventListItem[]> {
	const r = await rows(
		conn,
		`SELECT ${EVENT_COLUMNS} FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ? ORDER BY EVENT_NAME`,
		[db]
	);
	return r.map((x) => ({
		name: str(x.name),
		status: str(x.status),
		type: str(x.type),
		executeAt: strOrNull(x.execute_at),
		intervalValue: strOrNull(x.interval_value),
		intervalField: strOrNull(x.interval_field),
		starts: strOrNull(x.starts),
		ends: strOrNull(x.ends),
		definer: str(x.definer),
		comment: str(x.comment)
	}));
}

export async function getEvent(
	conn: Connection,
	db: string,
	name: string
): Promise<EventDef | null> {
	const [x] = await rows(
		conn,
		`SELECT ${EVENT_COLUMNS} FROM information_schema.EVENTS WHERE EVENT_SCHEMA = ? AND EVENT_NAME = ?`,
		[db, name]
	);
	if (!x) return null;
	const type = str(x.type) === 'RECURRING' ? 'RECURRING' : 'ONE TIME';
	return {
		name: str(x.name),
		status: str(x.status) as EventStatus,
		type: type as EventType,
		executeAt: str(x.execute_at),
		intervalValue: str(x.interval_value),
		intervalField: str(x.interval_field),
		starts: str(x.starts),
		ends: str(x.ends),
		definition: str(x.def),
		preserve: str(x.on_completion) === 'PRESERVE',
		definer: definerToInput(str(x.definer)),
		comment: str(x.comment)
	};
}

export const exportEvent = (conn: Connection, db: string, name: string) =>
	showCreate(conn, buildShowCreateEvent(db, name), 'Create Event');

export async function dropEvent(
	conn: Connection,
	db: string,
	name: string
): Promise<{ ok: boolean; error?: string; query: string }> {
	const query = buildDropEvent(db, name);
	try {
		await conn.query(query);
		return { ok: true, query };
	} catch (err) {
		return { ok: false, error: sqlErrorMessage(err), query };
	}
}

export async function saveEvent(
	conn: Connection,
	db: string,
	def: EventDef,
	originalName: string | null,
	tr: Translator = SOURCE_TRANSLATOR
): Promise<SaveResult> {
	const built = buildCreateEvent(db, def, tr);
	if (built.errors.length > 0) return { ok: false, errors: built.errors, queries: [] };
	if (originalName === null) return createOrReplace(conn, db, { createSql: built.sql, tr });
	let originalSql: string | null;
	try {
		originalSql = await exportEvent(conn, db, originalName);
	} catch (err) {
		return { ok: false, errors: [sqlErrorMessage(err)], queries: [] };
	}
	return createOrReplace(conn, db, {
		createSql: built.sql,
		dropSql: buildDropEvent(db, originalName),
		originalSql,
		tr
	});
}

export interface SchedulerState {
	/** ON, OFF, DISABLED, or null when the variable cannot be read. */
	state: string | null;
	/** Whether the current user may flip it (SUPER / SYSTEM_VARIABLES_ADMIN / ALL). */
	canToggle: boolean;
}

export async function getSchedulerState(conn: Connection): Promise<SchedulerState> {
	let state: string | null;
	try {
		const [r] = await rows(conn, 'SELECT @@global.event_scheduler AS s');
		state = r ? str(r.s).toUpperCase() : null;
	} catch {
		state = null;
	}
	let canToggle: boolean;
	try {
		const [u] = await rows(conn, 'SELECT CURRENT_USER() AS u');
		const current = str(u?.u);
		const at = current.lastIndexOf('@');
		const grantee = `'${current.slice(0, at)}'@'${current.slice(at + 1)}'`;
		const p = await rows(
			conn,
			'SELECT PRIVILEGE_TYPE AS p FROM information_schema.USER_PRIVILEGES WHERE GRANTEE = ? ' +
				"AND PRIVILEGE_TYPE IN ('SUPER', 'SYSTEM_VARIABLES_ADMIN')",
			[grantee]
		);
		canToggle = p.length > 0;
	} catch {
		canToggle = false;
	}
	return { state, canToggle };
}

export async function setScheduler(
	conn: Connection,
	enabled: boolean
): Promise<{ ok: boolean; error?: string; query: string }> {
	const query = `SET GLOBAL event_scheduler = ${enabled ? 'ON' : 'OFF'}`;
	try {
		await conn.query(query);
		return { ok: true, query };
	} catch (err) {
		return { ok: false, error: sqlErrorMessage(err), query };
	}
}
