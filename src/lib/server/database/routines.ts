/**
 * Database > Routines (Controllers/Database/RoutinesController.php, Database/Routines.php).
 */
import type { Connection } from '../db/connection';
import { definerToInput } from '#lib/sql/definer.ts';
import {
	buildCreateRoutine,
	buildDropRoutine,
	buildExecutionPlan,
	buildShowCreateRoutine,
	parseDtd,
	parseParameterRows,
	type ExecuteParam,
	type RoutineDef
} from '#lib/sql/routine.ts';
import type { RoutineType, SecurityType, SqlDataAccess } from '#lib/sql/routine-types.ts';
import { createOrReplace, rows, showCreate, sqlErrorMessage, str, type SaveResult } from './common';

export interface RoutineListItem {
	name: string;
	type: RoutineType;
	returns: string;
	definer: string;
	securityType: string;
	comment: string;
	deterministic: boolean;
	sqlDataAccess: string;
}

export async function listRoutines(conn: Connection, db: string): Promise<RoutineListItem[]> {
	const r = await rows(
		conn,
		'SELECT ROUTINE_NAME AS name, ROUTINE_TYPE AS type, DTD_IDENTIFIER AS returns_dtd, DEFINER AS definer, ' +
			'SECURITY_TYPE AS security_type, ROUTINE_COMMENT AS comment, IS_DETERMINISTIC AS det, ' +
			'SQL_DATA_ACCESS AS sda FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? ' +
			'ORDER BY ROUTINE_NAME, ROUTINE_TYPE',
		[db]
	);
	return r.map((x) => ({
		name: str(x.name),
		type: str(x.type) as RoutineType,
		returns: str(x.type) === 'FUNCTION' ? str(x.returns_dtd) : '',
		definer: str(x.definer),
		securityType: str(x.security_type),
		comment: str(x.comment),
		deterministic: str(x.det) === 'YES',
		sqlDataAccess: str(x.sda)
	}));
}

/** Load a routine into the editor model (Routines::getDataFromName). Null when it does not exist. */
export async function getRoutine(
	conn: Connection,
	db: string,
	type: RoutineType,
	name: string
): Promise<RoutineDef | null> {
	const [r] = await rows(
		conn,
		'SELECT ROUTINE_DEFINITION AS def, IS_DETERMINISTIC AS det, SQL_DATA_ACCESS AS sda, ' +
			'SECURITY_TYPE AS sec, ROUTINE_COMMENT AS comment, DEFINER AS definer, DTD_IDENTIFIER AS dtd ' +
			'FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = ? AND ROUTINE_NAME = ? AND ROUTINE_TYPE = ?',
		[db, name, type]
	);
	if (!r) return null;
	const pr = await rows(
		conn,
		'SELECT ORDINAL_POSITION AS ord, PARAMETER_MODE AS mode, PARAMETER_NAME AS pname, DTD_IDENTIFIER AS dtd, ' +
			'CHARACTER_SET_NAME AS cs FROM information_schema.PARAMETERS ' +
			'WHERE SPECIFIC_SCHEMA = ? AND SPECIFIC_NAME = ? AND ROUTINE_TYPE = ? ORDER BY ORDINAL_POSITION',
		[db, name, type]
	);
	const parsed = parseParameterRows(
		pr.map((p) => ({
			ordinal: Number(p.ord),
			mode: p.mode === null || p.mode === undefined ? null : str(p.mode),
			name: p.pname === null || p.pname === undefined ? null : str(p.pname),
			dtd: str(p.dtd),
			charset: p.cs === null || p.cs === undefined ? null : str(p.cs)
		}))
	);
	// No PARAMETERS row for the return value (very old servers): fall back to the ROUTINES DTD.
	const returns =
		type === 'FUNCTION' && !pr.some((p) => Number(p.ord) === 0)
			? parseDtd(str(r.dtd))
			: parsed.returns;
	const sda = str(r.sda).replace(/_/g, ' ');
	return {
		type,
		name,
		definer: definerToInput(str(r.definer)),
		params: parsed.params,
		returns,
		definition: str(r.def),
		deterministic: str(r.det) === 'YES',
		securityType: str(r.sec) as SecurityType,
		sqlDataAccess: sda as SqlDataAccess,
		comment: str(r.comment)
	};
}

export async function exportRoutine(
	conn: Connection,
	db: string,
	type: RoutineType,
	name: string
): Promise<string | null> {
	return showCreate(
		conn,
		buildShowCreateRoutine(db, type, name),
		type === 'PROCEDURE' ? 'Create Procedure' : 'Create Function'
	);
}

export async function dropRoutine(
	conn: Connection,
	db: string,
	type: RoutineType,
	name: string
): Promise<{ ok: boolean; error?: string; query: string }> {
	const query = buildDropRoutine(db, type, name);
	try {
		await conn.query(query);
		return { ok: true, query };
	} catch (err) {
		return { ok: false, error: sqlErrorMessage(err), query };
	}
}

/**
 * Create a routine, or replace `original` (DROP + CREATE with a rollback attempt, like phpMyAdmin).
 */
export async function saveRoutine(
	conn: Connection,
	db: string,
	def: RoutineDef,
	original: { type: RoutineType; name: string } | null
): Promise<SaveResult> {
	const built = buildCreateRoutine(db, def);
	if (built.errors.length > 0) return { ok: false, errors: built.errors, queries: [] };
	if (!original) return createOrReplace(conn, db, { createSql: built.sql });
	let originalSql: string | null;
	try {
		originalSql = await exportRoutine(conn, db, original.type, original.name);
	} catch (err) {
		return { ok: false, errors: [sqlErrorMessage(err)], queries: [] };
	}
	return createOrReplace(conn, db, {
		createSql: built.sql,
		dropSql: buildDropRoutine(db, original.type, original.name),
		originalSql
	});
}

export type CellValue = string | null;

export interface ResultSet {
	columns: string[];
	rows: CellValue[][];
}

export interface ExecuteResult {
	ok: boolean;
	error?: string;
	queries: string[];
	resultSets: ResultSet[];
	/** Values of OUT / INOUT parameters (procedures). */
	outParams: { name: string; value: CellValue }[];
	/** Rows affected by the CALL when it returned no result set. */
	affectedRows: number | null;
}

function cell(v: unknown): CellValue {
	if (v === null || v === undefined) return null;
	if (Buffer.isBuffer(v)) return v.toString('utf8');
	if (typeof v === 'object') return JSON.stringify(v);
	return String(v);
}

function toResultSet(rowList: unknown[], fields: { name: string }[] | undefined): ResultSet {
	const columns = (fields ?? []).map((f) => f.name);
	const first = (rowList[0] ?? null) as Record<string, unknown> | null;
	const cols = columns.length > 0 ? columns : first ? Object.keys(first) : [];
	return {
		columns: cols,
		rows: rowList.map((row) => cols.map((c) => cell((row as Record<string, unknown>)[c])))
	};
}

/**
 * Run a routine. IN values are literals; OUT/INOUT go through session variables on this connection.
 * mysql2 returns one entry per result set for CALL; each is rendered.
 */
export async function executeRoutine(
	conn: Connection,
	db: string,
	type: RoutineType,
	name: string,
	params: ExecuteParam[]
): Promise<ExecuteResult> {
	const plan = buildExecutionPlan(db, type, name, params);
	const queries = [...plan.setup, plan.call, ...(plan.outSelect ? [plan.outSelect] : [])];
	const result: ExecuteResult = {
		ok: true,
		queries,
		resultSets: [],
		outParams: [],
		affectedRows: null
	};
	try {
		for (const s of plan.setup) await conn.query(s);
		const [res, fields] = await conn.query(plan.call);
		const fieldList = fields as unknown;
		if (Array.isArray(res) && Array.isArray(fieldList) && Array.isArray(fieldList[0])) {
			// CALL: array of [rows[], ..., ResultSetHeader]
			(res as unknown[]).forEach((part, i) => {
				if (Array.isArray(part)) {
					result.resultSets.push(
						toResultSet(part, (fieldList as ({ name: string }[] | undefined)[])[i])
					);
				} else if (part && typeof part === 'object' && 'affectedRows' in part) {
					result.affectedRows = Number((part as { affectedRows: unknown }).affectedRows);
				}
			});
		} else if (Array.isArray(res)) {
			result.resultSets.push(toResultSet(res, fieldList as { name: string }[]));
		} else if (res && typeof res === 'object' && 'affectedRows' in res) {
			result.affectedRows = Number((res as { affectedRows: unknown }).affectedRows);
		}
		if (plan.outSelect) {
			const [out] = await rows(conn, plan.outSelect);
			result.outParams = plan.outNames.map((n) => ({ name: n, value: cell(out?.[n]) }));
		}
	} catch (err) {
		result.ok = false;
		result.error = sqlErrorMessage(err);
	}
	return result;
}
