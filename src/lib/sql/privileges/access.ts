/**
 * "Users having access to <db>" (Privileges::getAllPrivileges): which grants of an account reach a database or
 * table. Pure: works on the parsed SHOW GRANTS of the account.
 */
import { escapeWildcards, unescapeWildcards } from './account.ts';
import type { CopyGrants } from './copy-user.ts';
import { summarizePrivileges } from './summary.ts';
import type { PrivServer } from './types.ts';

const regexEscape = (c: string) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** MySQL `value LIKE pattern` with `\` as escape (what `'db' LIKE mysql.db.Db` does). */
export function likeMatch(pattern: string, value: string): boolean {
	let re = '^';
	for (let i = 0; i < pattern.length; i++) {
		const c = pattern[i];
		if (c === '\\' && i + 1 < pattern.length) re += regexEscape(pattern[++i]);
		else if (c === '%') re += '[\\s\\S]*';
		else if (c === '_') re += '[\\s\\S]';
		else re += regexEscape(c);
	}
	return new RegExp(re + '$', 'i').test(value);
}

export type AccessType = 'global' | 'database-specific' | 'wildcard' | 'table-specific' | 'routine';

export interface AccessEntry {
	type: AccessType;
	/** Database as stored (pattern for wildcard grants); `*` for global. */
	db: string;
	table?: string;
	routine?: string;
	routineType?: string;
	privileges: string[];
	grantOption: boolean;
}

/** Grants of one account that apply to `db` (and `table` when given). */
export function accessEntries(grants: CopyGrants, db: string, table?: string): AccessEntry[] {
	const out: AccessEntry[] = [];
	const g = grants.global;
	if (g.privileges.length > 0 || g.grantOption) {
		out.push({ type: 'global', db: '*', privileges: g.privileges, grantOption: g.grantOption });
	}
	for (const d of grants.databases) {
		if (!likeMatch(d.db, db)) continue;
		if (d.privileges.length === 0 && !d.grantOption) continue;
		out.push({
			type: d.db === escapeWildcards(db) || d.db === db ? 'database-specific' : 'wildcard',
			db: d.db,
			privileges: d.privileges,
			grantOption: d.grantOption
		});
	}
	if (table !== undefined) {
		for (const t of grants.tables) {
			if (unescapeWildcards(t.db).toLowerCase() !== db.toLowerCase() || t.table !== table) continue;
			out.push({
				type: 'table-specific',
				db: t.db,
				table: t.table,
				privileges: [
					...t.privileges,
					...t.columns.map((c) => `${c.privilege} (${c.columns.join(', ')})`)
				],
				grantOption: t.grantOption
			});
		}
	}
	for (const r of grants.routines) {
		if (unescapeWildcards(r.db).toLowerCase() !== db.toLowerCase()) continue;
		out.push({
			type: 'routine',
			db: r.db,
			routine: r.routine,
			routineType: r.type,
			privileges: r.privileges,
			grantOption: r.grantOption
		});
	}
	return out;
}

/** `ALL PRIVILEGES` / `USAGE` / list text of an access entry. */
export function describeAccess(e: AccessEntry, server: PrivServer): string {
	if (e.type === 'table-specific' || e.type === 'routine') {
		return e.privileges.length ? e.privileges.join(', ') : 'USAGE';
	}
	const scope = e.type === 'global' ? 'global' : 'database';
	return summarizePrivileges(e.privileges, scope, server).items.join(', ');
}
