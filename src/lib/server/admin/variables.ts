/**
 * Server variables (phpMyAdmin Controllers/Server/VariablesController.php and
 * Controllers/Server/Variables/{Get,Set}VariableController.php).
 *
 * Pure helpers (formatting, input parsing, SQL building) come first; the queries use the
 * connection passed in (`locals.db`).
 */
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { formatBytes, formatNumber } from '#lib/format.ts';
import { escapeId } from '#lib/server/db/escape.ts';
import { BYTE_VARIABLE_NAMES } from './byte-variables.ts';

const VARIABLE_NAME = /^[A-Za-z0-9_]+$/;
const NUMERIC = /^-?\d+(\.\d+)?$/;
const INTEGER = /^-?\d+$/;
const BYTE_INPUT = /^\s*(\d+(\.\d+)?)\s*(mb|kb|mib|kib|gb|gib)\s*$/i;
const BYTE_INPUT_EXPONENT: Record<string, number> = { kb: 1, kib: 1, mb: 2, mib: 2, gb: 3, gib: 3 };

export class VariableError extends Error {}

export function isByteVariable(name: string): boolean {
	return BYTE_VARIABLE_NAMES.has(name.toLowerCase());
}

export interface FormattedValue {
	text: string;
	/** Raw value, shown as a tooltip for byte-sized values. */
	title?: string;
}

/**
 * Display form of a variable value: byte sizes as `128.000 MiB` (Util::formatByteDown with
 * (3, 3)), integers grouped, the rest verbatim. Integers beyond the safe range stay exact as text.
 */
export function formatVariableValue(name: string, value: string): FormattedValue {
	if (isByteVariable(name) && NUMERIC.test(value)) {
		return { text: formatBytes(value, 3, 3), title: value };
	}
	if (INTEGER.test(value) && Number.isSafeInteger(Number(value))) {
		return { text: formatNumber(value) };
	}
	return { text: value };
}

/** Is `name` an existing global variable? Only plain identifiers are accepted before the lookup. */
export function isValidVariableName(name: string, known: ReadonlySet<string>): boolean {
	return VARIABLE_NAME.test(name) && known.has(name);
}

/**
 * Parse the value typed in the edit box. Byte variables accept `128 MB`, `512kib`, ... (converted to
 * bytes like phpMyAdmin's SetVariableController). Numeric input becomes a number (sent unquoted),
 * everything else stays a string (sent quoted).
 */
export function parseVariableInput(name: string, input: string): string | number {
	const byte = isByteVariable(name) ? BYTE_INPUT.exec(input) : null;
	if (byte) {
		return Number(byte[1]) * 1024 ** BYTE_INPUT_EXPONENT[byte[3].toLowerCase()];
	}
	const value = input.trim();
	if (NUMERIC.test(value)) {
		const n = Number(value);
		if (value.includes('.') ? Number.isFinite(n) : Number.isSafeInteger(n)) return n;
	}
	return value;
}

/**
 * `SET GLOBAL <name> = ?`: the name is backtick-quoted (after the pattern check), the value goes through
 * a placeholder so numbers are sent unquoted and strings are escaped and quoted by the driver.
 */
export function buildSetGlobalStatement(
	name: string,
	value: string | number
): { sql: string; params: [string | number] } {
	if (!VARIABLE_NAME.test(name)) throw new VariableError(`Invalid variable name '${name}'.`);
	return { sql: `SET GLOBAL ${escapeId(name)} = ?`, params: [value] };
}

export interface VariableRow {
	name: string;
	value: string;
	display: string;
	title?: string;
	/** Session value, only when it differs from the global one. */
	sessionDisplay: string | null;
	sessionTitle?: string;
}

/** Merge `SHOW GLOBAL VARIABLES` and `SHOW SESSION VARIABLES` into display rows (phpMyAdmin's loop). */
export function buildVariableRows(
	globals: ReadonlyMap<string, string>,
	sessions: ReadonlyMap<string, string>
): VariableRow[] {
	return [...globals].map(([name, value]) => {
		const formatted = formatVariableValue(name, value);
		const session = sessions.get(name);
		const hasSession = session !== undefined && session !== value;
		const sessionFormatted = hasSession ? formatVariableValue(name, session) : null;
		return {
			name,
			value,
			display: formatted.text,
			...(formatted.title !== undefined ? { title: formatted.title } : {}),
			sessionDisplay: sessionFormatted ? sessionFormatted.text : null,
			...(sessionFormatted?.title !== undefined ? { sessionTitle: sessionFormatted.title } : {})
		};
	});
}

async function showVariables(
	conn: Connection,
	scope: 'GLOBAL' | 'SESSION'
): Promise<Map<string, string>> {
	const [rows] = await conn.query<RowDataPacket[]>(`SHOW ${scope} VARIABLES`);
	return new Map(rows.map((r) => [String(r.Variable_name), String(r.Value ?? '')]));
}

export async function listVariableRows(conn: Connection): Promise<VariableRow[]> {
	const globals = await showVariables(conn, 'GLOBAL');
	const sessions = await showVariables(conn, 'SESSION');
	return buildVariableRows(globals, sessions);
}

/**
 * Set one global variable after checking the name against the server's real list. Returns the value
 * the server holds afterwards (some values are rounded or clamped). MySQL errors propagate.
 */
export async function setGlobalVariable(
	conn: Connection,
	name: string,
	input: string
): Promise<{ name: string; value: string }> {
	const globals = await showVariables(conn, 'GLOBAL');
	if (!isValidVariableName(name, new Set(globals.keys()))) {
		throw new VariableError(`Unknown variable '${name}'.`);
	}
	const stmt = buildSetGlobalStatement(name, parseVariableInput(name, input));
	await conn.query(stmt.sql, stmt.params);
	const after = await showVariables(conn, 'GLOBAL');
	return { name, value: after.get(name) ?? '' };
}

/** Human message for a failed statement: MySQL's own text only (`sqlMessage`), never stack or SQL. */
export function variableErrorMessage(err: unknown): string {
	if (err instanceof VariableError) return err.message;
	const sqlMessage = (err as { sqlMessage?: unknown } | null)?.sqlMessage;
	return typeof sqlMessage === 'string' && sqlMessage !== ''
		? sqlMessage
		: 'Setting the variable failed.';
}
