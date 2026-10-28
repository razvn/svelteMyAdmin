/**
 * DEFINER handling shared by routines, events and triggers
 * (Routines::getQueryFromRequest, Events::getQueryFromRequest, Triggers::getQueryFromRequest).
 */
import { escapeId } from '#lib/server/db/escape.ts';

export interface Definer {
	user: string;
	host: string;
}

const PART = "(`(?:[^`]|``)+`|'(?:[^']|'')+'|[^@`']+)";
const DEFINER_RE = new RegExp(`^${PART}@${PART}$`);

function unquotePart(part: string): string {
	if (part.startsWith('`')) return part.slice(1, -1).replaceAll('``', '`');
	if (part.startsWith("'")) return part.slice(1, -1).replaceAll("''", "'");
	return part;
}

/**
 * Parse "user@host" where either part may be backquoted or single-quoted already
 * (phpMyAdmin does not re-quote an already backquoted part). Null when malformed.
 */
export function parseDefiner(input: string): Definer | null {
	const m = DEFINER_RE.exec(input.trim());
	if (!m) return null;
	return { user: unquotePart(m[1]), host: unquotePart(m[2]) };
}

/** Split the DEFINER column of information_schema ("root@%") on the LAST "@". */
export function splitStoredDefiner(stored: string): Definer {
	const at = stored.lastIndexOf('@');
	if (at < 0) return { user: stored, host: '' };
	return { user: stored.slice(0, at), host: stored.slice(at + 1) };
}

/** `user`@`host`. */
export function formatDefiner(definer: Definer): string {
	return `${escapeId(definer.user)}@${escapeId(definer.host)}`;
}

/** Stored (information_schema) value back to the "user@host" text shown in the editor. */
export function definerToInput(stored: string): string {
	const d = splitStoredDefiner(stored);
	return d.host === '' ? d.user : `${d.user}@${d.host}`;
}

export type DefinerClause = { clause: string; error: null } | { clause: ''; error: string };

/**
 * "DEFINER=`user`@`host` " for the CREATE statement; empty input gives an empty clause,
 * CURRENT_USER is passed through verbatim.
 */
export function buildDefinerClause(input: string): DefinerClause {
	const text = input.trim();
	if (text === '') return { clause: '', error: null };
	if (/^current_user(\(\))?$/i.test(text)) return { clause: 'DEFINER=CURRENT_USER ', error: null };
	const parsed = parseDefiner(text);
	if (!parsed) {
		return { clause: '', error: 'The definer must be in the "username@hostname" format!' };
	}
	return { clause: `DEFINER=${formatDefiner(parsed)} `, error: null };
}
