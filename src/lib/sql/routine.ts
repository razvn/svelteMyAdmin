/**
 * Pure SQL builders and parsers for stored routines
 * (Database/Routines.php: getQueryFromRequest, getDataFromName, getQueriesFromRoutineForm).
 */
import { escapeId, escapeQualified, escapeString } from '#lib/server/db/escape.ts';
import { buildDefinerClause } from './definer.ts';
import {
	ROUTINE_DATA_TYPES,
	PARAM_DIRECTIONS,
	SQL_DATA_ACCESS,
	acceptsLength,
	isCharsetType,
	isNumericType,
	requiresLength,
	type ParamDirection,
	type RoutineType,
	type SecurityType,
	type SqlDataAccess
} from './routine-types.ts';

export interface RoutineParam {
	direction: ParamDirection;
	name: string;
	type: string;
	length: string;
	/** Charset for character types, UNSIGNED/ZEROFILL for numeric types. */
	opts: string;
}

export interface RoutineReturns {
	type: string;
	length: string;
	opts: string;
}

export interface RoutineDef {
	type: RoutineType;
	name: string;
	definer: string;
	params: RoutineParam[];
	returns: RoutineReturns;
	definition: string;
	deterministic: boolean;
	securityType: SecurityType | '';
	sqlDataAccess: SqlDataAccess | '';
	comment: string;
}

export interface BuildResult {
	sql: string;
	errors: string[];
}

const LENGTH_RE = /^\d+(\s*,\s*\d+)?$/;
const LIST_RE = /^\s*'(?:[^'\\]|\\.|'')*'(\s*,\s*'(?:[^'\\]|\\.|'')*')*\s*$/;
const CHARSET_RE = /^[A-Za-z0-9_]{1,64}$/;

/** Length/values suffix "(...)" validated so it cannot break out of the parameter list. */
function lengthSuffix(type: string, length: string, errors: string[]): string {
	const len = length.trim();
	if (len === '') {
		if (requiresLength(type)) {
			errors.push(
				'You must provide length/values for routine parameters of type ENUM, SET, VARCHAR and VARBINARY.'
			);
		}
		return '';
	}
	if (!acceptsLength(type)) return '';
	const upper = type.toUpperCase();
	const ok = upper === 'ENUM' || upper === 'SET' ? LIST_RE.test(len) : LENGTH_RE.test(len);
	if (!ok) {
		errors.push(`Invalid length/values "${len}" for type ${upper}.`);
		return '';
	}
	return `(${len})`;
}

function optionsSuffix(type: string, opts: string, errors: string[]): string {
	const o = opts.trim();
	if (o === '') return '';
	if (isCharsetType(type)) {
		if (!CHARSET_RE.test(o)) {
			errors.push(`Invalid character set "${o}".`);
			return '';
		}
		return ` CHARSET ${o.toLowerCase()}`;
	}
	if (isNumericType(type)) {
		const up = o.toUpperCase();
		if (!['UNSIGNED', 'ZEROFILL', 'UNSIGNED ZEROFILL'].includes(up)) {
			errors.push(`Invalid numeric option "${o}".`);
			return '';
		}
		return ` ${up}`;
	}
	return '';
}

function validType(type: string): boolean {
	return (ROUTINE_DATA_TYPES as readonly string[]).includes(type.toUpperCase());
}

/** Parameter list "IN `a` INT, OUT `b` VARCHAR(10) CHARSET utf8mb4". */
export function buildParamList(
	type: RoutineType,
	params: RoutineParam[],
	errors: string[] = []
): string {
	const parts: string[] = [];
	for (const p of params) {
		if (p.name.trim() === '' || p.type.trim() === '') {
			errors.push('You must provide a name and a type for each routine parameter.');
			break;
		}
		if (!validType(p.type)) {
			errors.push(`Invalid type "${p.type}" for parameter ${p.name}.`);
			continue;
		}
		let part = '';
		if (type === 'PROCEDURE') {
			if (!(PARAM_DIRECTIONS as readonly string[]).includes(p.direction)) {
				errors.push(`Invalid direction "${p.direction}" given for parameter.`);
				continue;
			}
			part += `${p.direction} `;
		}
		part += `${escapeId(p.name)} ${p.type.toUpperCase()}`;
		part += lengthSuffix(p.type, p.length, errors);
		part += optionsSuffix(p.type, p.opts, errors);
		parts.push(part);
	}
	return parts.join(', ');
}

/** "RETURNS INT(11) UNSIGNED " */
export function buildReturns(returns: RoutineReturns, errors: string[] = []): string {
	if (!validType(returns.type)) {
		errors.push('You must provide a valid return type for the routine.');
		return '';
	}
	let sql = `RETURNS ${returns.type.toUpperCase()}`;
	sql += lengthSuffix(returns.type, returns.length, errors);
	sql += optionsSuffix(returns.type, returns.opts, errors);
	return sql + ' ';
}

/** CREATE statement for a routine in `db` (Routines::getQueryFromRequest). */
export function buildCreateRoutine(db: string, def: RoutineDef): BuildResult {
	const errors: string[] = [];
	let sql = 'CREATE ';
	const definer = buildDefinerClause(def.definer);
	if (definer.error) errors.push(definer.error);
	sql += definer.clause;

	if (def.type !== 'PROCEDURE' && def.type !== 'FUNCTION') {
		errors.push(`Invalid routine type: "${def.type}"`);
	}
	sql += `${def.type} `;

	if (def.name.trim() === '') errors.push('You must provide a routine name!');
	else sql += escapeQualified(db, def.name);

	sql += `(${buildParamList(def.type, def.params, errors)}) `;
	if (def.type === 'FUNCTION') sql += buildReturns(def.returns, errors);

	if (def.comment !== '') sql += `COMMENT '${escapeString(def.comment)}' `;
	sql += def.deterministic ? 'DETERMINISTIC ' : 'NOT DETERMINISTIC ';
	if (
		def.sqlDataAccess !== '' &&
		(SQL_DATA_ACCESS as readonly string[]).includes(def.sqlDataAccess)
	) {
		sql += `${def.sqlDataAccess} `;
	}
	if (def.securityType === 'DEFINER' || def.securityType === 'INVOKER') {
		sql += `SQL SECURITY ${def.securityType} `;
	}
	if (def.definition.trim() === '') errors.push('You must provide a routine definition.');
	else sql += def.definition;
	return { sql, errors };
}

export function buildDropRoutine(db: string, type: RoutineType, name: string): string {
	return `DROP ${type} ${escapeQualified(db, name)}`;
}

export function buildShowCreateRoutine(db: string, type: RoutineType, name: string): string {
	return `SHOW CREATE ${type} ${escapeQualified(db, name)}`;
}

// ---------------------------------------------------------------------------------------------
// Parsing information_schema.PARAMETERS / ROUTINES rows (MySQL and MariaDB differ slightly)
// ---------------------------------------------------------------------------------------------

export interface ParsedType {
	type: string;
	length: string;
	opts: string;
}

/**
 * Split a DTD_IDENTIFIER ("int unsigned", "varchar(20) CHARSET utf8mb4", "decimal(10,2)",
 * "enum('a','b')", MariaDB "int(10) unsigned") into type, length/values and options.
 * `charset` (CHARACTER_SET_NAME) is used for character types when the DTD does not carry one.
 */
export function parseDtd(dtd: string, charset: string | null = null): ParsedType {
	const text = dtd.trim();
	const open = text.indexOf('(');
	let type: string;
	let length = '';
	let rest: string;
	if (open < 0) {
		const m = /^(\S+)\s*(.*)$/s.exec(text);
		type = m?.[1] ?? text;
		rest = m?.[2] ?? '';
	} else {
		type = text.slice(0, open).trim();
		// find the matching ")" ignoring parentheses inside quoted values
		let depth = 0;
		let quote = false;
		let close = -1;
		for (let i = open; i < text.length; i++) {
			const c = text[i];
			if (quote) {
				if (c === '\\') i++;
				else if (c === "'") {
					if (text[i + 1] === "'") i++;
					else quote = false;
				}
			} else if (c === "'") quote = true;
			else if (c === '(') depth++;
			else if (c === ')' && --depth === 0) {
				close = i;
				break;
			}
		}
		if (close < 0) close = text.length;
		length = text.slice(open + 1, close);
		rest = text.slice(close + 1).trim();
	}
	type = type.toUpperCase();
	let cs = charset ?? '';
	const csMatch = /\b(?:CHARSET|CHARACTER SET)\s+(\w+)/i.exec(rest);
	if (csMatch) cs = csMatch[1];
	rest = rest
		.replace(/\b(?:CHARSET|CHARACTER SET)\s+\w+/gi, '')
		.replace(/\bCOLLATE\s+\w+/gi, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toUpperCase();
	// MySQL reports BOOL as tinyint(1); keep the DTD type as is.
	let opts = '';
	if (isCharsetType(type)) opts = cs;
	else if (isNumericType(type)) opts = rest;
	return { type, length, opts };
}

export interface ParameterRow {
	ordinal: number;
	mode: string | null;
	name: string | null;
	dtd: string;
	charset: string | null;
}

/**
 * Rows of information_schema.PARAMETERS (ordinal 0 is the function return value) to params + returns.
 * MySQL reports PARAMETER_MODE NULL for functions, MariaDB reports 'IN'.
 */
export function parseParameterRows(rows: ParameterRow[]): {
	params: RoutineParam[];
	returns: RoutineReturns;
} {
	const sorted = [...rows].sort((a, b) => a.ordinal - b.ordinal);
	const params: RoutineParam[] = [];
	let returns: RoutineReturns = { type: 'INT', length: '', opts: '' };
	for (const r of sorted) {
		const t = parseDtd(r.dtd, r.charset);
		if (r.ordinal === 0) {
			returns = t;
			continue;
		}
		const mode = (r.mode ?? 'IN').toUpperCase();
		params.push({
			direction: (PARAM_DIRECTIONS as readonly string[]).includes(mode)
				? (mode as ParamDirection)
				: 'IN',
			name: r.name ?? '',
			...t
		});
	}
	return { params, returns };
}

// ---------------------------------------------------------------------------------------------
// Execution (Routines::getQueriesFromRoutineForm)
// ---------------------------------------------------------------------------------------------

export interface ExecuteParam {
	direction: ParamDirection;
	name: string;
	type: string;
	value: string;
	isNull: boolean;
}

const NUMERIC_LITERAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/** SQL literal for an IN/INOUT argument: numbers verbatim for numeric types, strings quoted. */
export function quoteArgument(type: string, value: string, isNull: boolean): string {
	if (isNull) return 'NULL';
	if (isNumericType(type) && NUMERIC_LITERAL.test(value.trim())) return value.trim();
	return `'${escapeString(value)}'`;
}

export interface ExecutionPlan {
	/** SET @var = ... for INOUT parameters, run first. */
	setup: string[];
	/** The CALL or SELECT fn(...) statement. */
	call: string;
	/** SELECT of the session variables holding OUT/INOUT values (procedures only), or null. */
	outSelect: string | null;
	outNames: string[];
}

export function buildExecutionPlan(
	db: string,
	type: RoutineType,
	name: string,
	params: ExecuteParam[]
): ExecutionPlan {
	const setup: string[] = [];
	const args: string[] = [];
	const outVars: { variable: string; name: string }[] = [];
	params.forEach((p, i) => {
		const variable = `@_sma_p${i}`;
		if (type === 'PROCEDURE' && p.direction === 'OUT') {
			args.push(variable);
			outVars.push({ variable, name: p.name });
		} else if (type === 'PROCEDURE' && p.direction === 'INOUT') {
			setup.push(`SET ${variable} = ${quoteArgument(p.type, p.value, p.isNull)}`);
			args.push(variable);
			outVars.push({ variable, name: p.name });
		} else {
			args.push(quoteArgument(p.type, p.value, p.isNull));
		}
	});
	const qualified = escapeQualified(db, name);
	if (type === 'FUNCTION') {
		return {
			setup,
			call: `SELECT ${qualified}(${args.join(', ')}) AS ${escapeId(name)}`,
			outSelect: null,
			outNames: []
		};
	}
	return {
		setup,
		call: `CALL ${qualified}(${args.join(', ')})`,
		outSelect:
			outVars.length > 0
				? `SELECT ${outVars.map((o) => `${o.variable} AS ${escapeId(o.name)}`).join(', ')}`
				: null,
		outNames: outVars.map((o) => o.name)
	};
}
