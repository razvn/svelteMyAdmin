/**
 * Parser for the rows of `SHOW GRANTS` (MySQL 8.4 and MariaDB 11.4 flavours, tolerant of older output) into a
 * structured model. Ports the idea of CheckUserPrivileges::getItemsFromShowGrantsRow but handles the whole
 * grammar: privilege lists with column lists, ALL PRIVILEGES expansion, dynamic privileges (comma separated
 * without spaces), PROXY grants, role grants (`GRANT `r`@`%` TO ...`, `WITH ADMIN OPTION`), partial revokes and
 * the MariaDB tail (IDENTIFIED BY PASSWORD / VIA, REQUIRE, WITH GRANT OPTION MAX_...).
 */
import {
	allPrivilegeNames,
	normalizePrivilegeName,
	isDynamicPrivilege,
	type PrivServer,
	type ResourceLimits,
	type RoutineType,
	type Scope,
	type SslRequirement
} from '#lib/sql/privileges/index.ts';

export interface GlobalGrant {
	/** Privilege keywords (ALL PRIVILEGES expanded for the server). */
	privileges: string[];
	/** WITH GRANT OPTION on a line with static privileges or USAGE. */
	grantOption: boolean;
	/** Privileges that carry the grant option (every privilege of a WITH GRANT OPTION line). */
	grantable: string[];
}

export interface DatabaseGrant {
	/** Name as stored, i.e. possibly a pattern with escaped wildcards (`app\_%`). */
	db: string;
	privileges: string[];
	grantOption: boolean;
}

export interface ColumnGrant {
	privilege: string;
	columns: string[];
}

export interface TableGrant {
	db: string;
	table: string;
	privileges: string[];
	columns: ColumnGrant[];
	grantOption: boolean;
}

export interface RoutineGrant {
	db: string;
	routine: string;
	type: RoutineType | 'PACKAGE' | 'PACKAGE BODY';
	privileges: string[];
	grantOption: boolean;
}

export interface ProxyGrant {
	proxied: { user: string; host: string };
	grantOption: boolean;
}

export interface RoleGrant {
	role: string;
	/** null on MariaDB (roles have no host) */
	host: string | null;
	adminOption: boolean;
}

/** What MariaDB repeats in SHOW GRANTS (MySQL 8 keeps these in `mysql.user` / SHOW CREATE USER). */
export interface GrantsTail {
	passwordHash?: string;
	plugins?: string[];
	pluginArgument?: string;
	ssl?: SslRequirement;
	limits?: Partial<ResourceLimits>;
}

export interface ParsedGrants {
	global: GlobalGrant;
	databases: DatabaseGrant[];
	tables: TableGrant[];
	routines: RoutineGrant[];
	proxies: ProxyGrant[];
	roles: RoleGrant[];
	/** `REVOKE ... ON ...` lines of partial revokes (MySQL), kept verbatim. */
	partialRevokes: string[];
	/** The IDENTIFIED / REQUIRE / limits seen on the global line (MariaDB). */
	tail: GrantsTail;
	/** Lines the parser could not understand. */
	unparsed: string[];
}

export const emptyGrants = (): ParsedGrants => ({
	global: { privileges: [], grantOption: false, grantable: [] },
	databases: [],
	tables: [],
	routines: [],
	proxies: [],
	roles: [],
	partialRevokes: [],
	tail: {},
	unparsed: []
});

// ---- scanning helpers ----

const QUOTES = new Set(['`', "'", '"']);

/** Index just after the quoted token starting at `pos` (doubled quotes and backslash escapes handled). */
function skipQuoted(text: string, pos: number): number {
	const q = text[pos];
	let i = pos + 1;
	while (i < text.length) {
		const c = text[i];
		if (c === '\\' && q !== '`') {
			i += 2;
			continue;
		}
		if (c === q) {
			if (text[i + 1] === q) {
				i += 2;
				continue;
			}
			return i + 1;
		}
		i++;
	}
	return text.length;
}

/** Position of `needle` outside quotes and parentheses at or after `from`, or -1. */
function findTopLevel(text: string, needle: string, from = 0): number {
	let depth = 0;
	for (let i = from; i < text.length;) {
		const c = text[i];
		if (QUOTES.has(c)) {
			i = skipQuoted(text, i);
			continue;
		}
		if (c === '(') depth++;
		else if (c === ')') depth = Math.max(0, depth - 1);
		else if (depth === 0 && text.startsWith(needle, i)) return i;
		i++;
	}
	return -1;
}

/** Split at top-level commas. */
function splitTopLevel(text: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < text.length;) {
		const c = text[i];
		if (QUOTES.has(c)) {
			i = skipQuoted(text, i);
			continue;
		}
		if (c === '(') depth++;
		else if (c === ')') depth = Math.max(0, depth - 1);
		else if (c === ',' && depth === 0) {
			out.push(text.slice(start, i));
			start = i + 1;
		}
		i++;
	}
	out.push(text.slice(start));
	return out.map((s) => s.trim()).filter((s) => s !== '');
}

function unquote(token: string): string {
	const q = token[0];
	if (!QUOTES.has(q)) return token;
	const end = skipQuoted(token, 0);
	const inner = token.slice(1, end - 1);
	if (q === '`') return inner.replaceAll('``', '`');
	return inner
		.replaceAll(q + q, q)
		.replace(/\\(.)/g, (_, c: string) =>
			c === 'n' ? '\n' : c === 'r' ? '\r' : c === '0' ? '\0' : c
		);
}

/** Parse one identifier / string / bare word at `pos`; returns the value and the index after it. */
function readName(text: string, pos: number): { value: string; end: number } | null {
	if (pos >= text.length) return null;
	if (QUOTES.has(text[pos])) {
		const end = skipQuoted(text, pos);
		return { value: unquote(text.slice(pos, end)), end };
	}
	const m = /^[^\s,@.]+/.exec(text.slice(pos));
	return m ? { value: m[0], end: pos + m[0].length } : null;
}

/** `user`@`host` or a MariaDB role name without host. */
function readAccount(
	text: string,
	pos: number
): { user: string; host: string | null; end: number } | null {
	while (text[pos] === ' ') pos++;
	const first = readName(text, pos);
	if (!first) return null;
	if (text[first.end] === '@') {
		const host = readName(text, first.end + 1);
		if (!host) return null;
		return { user: first.value, host: host.value, end: host.end };
	}
	return { user: first.value, host: null, end: first.end };
}

/** Split `a`.`b` / `*`.* / db.* into two parts. Returns null when the text is not of that form. */
function splitObject(text: string): [string, string] | null {
	const dot = findTopLevel(text, '.');
	if (dot < 0) return null;
	const part = (s: string) => (s.trim() === '*' ? '*' : unquote(s.trim()));
	return [part(text.slice(0, dot)), part(text.slice(dot + 1))];
}

function parsePrivilegeItem(
	raw: string,
	server: PrivServer
): { name: string; columns: string[] | null } {
	const paren = raw.indexOf('(');
	if (paren < 0) return { name: normalizePrivilegeName(raw, server), columns: null };
	const name = normalizePrivilegeName(raw.slice(0, paren), server);
	const columns: string[] = [];
	const inner = raw.slice(paren + 1, raw.lastIndexOf(')'));
	for (const part of splitTopLevel(inner)) columns.push(unquote(part));
	return { name, columns };
}

/** Parse the part of a MariaDB (or old MySQL) line after `TO grantee`. */
export function parseGrantTail(
	tail: string
): { grantOption: boolean; adminOption: boolean } & GrantsTail {
	const out: { grantOption: boolean; adminOption: boolean } & GrantsTail = {
		grantOption: false,
		adminOption: false
	};
	// Hide the content of string literals so keywords inside them are not matched; indexes stay aligned.
	let masked = '';
	for (let i = 0; i < tail.length;) {
		if (tail[i] === "'") {
			const end = skipQuoted(tail, i);
			masked += "'" + '_'.repeat(Math.max(0, end - i - 2)) + "'";
			i = end;
		} else {
			masked += tail[i];
			i++;
		}
	}
	const literal = (idx: number): { value: string; end: number } | null => {
		let i = idx;
		while (masked[i] === ' ') i++;
		if (masked[i] !== "'") return null;
		const end = skipQuoted(tail, i);
		return { value: unquote(tail.slice(i, end)), end };
	};

	const identified = /\bIDENTIFIED\b/.exec(masked);
	if (identified) {
		const byPw = /\bIDENTIFIED BY PASSWORD\b/.exec(masked);
		if (byPw) {
			const l = literal(byPw.index + byPw[0].length);
			if (l) out.passwordHash = l.value;
		}
		const via = /\bIDENTIFIED VIA ([A-Za-z0-9_ |]+?)(?= USING | AS |$| REQUIRE | WITH )/.exec(
			masked
		);
		if (via) {
			out.plugins = via[1].split(/\s+OR\s+/i).map((s) => s.trim());
			const using = /\b(?:USING|AS) /.exec(masked.slice(via.index + via[0].length - 0));
			if (using) {
				const l = literal(via.index + via[0].length + using.index + using[0].length);
				if (l) out.pluginArgument = l.value;
			}
		}
		const withAs = /\bIDENTIFIED WITH ([A-Za-z0-9_]+) AS /.exec(masked);
		if (withAs) {
			out.plugins = [withAs[1]];
			const l = literal(withAs.index + withAs[0].length);
			if (l) out.pluginArgument = l.value;
		}
	}

	const req = /\bREQUIRE\b/.exec(masked);
	if (req) {
		const after = masked.slice(req.index + req[0].length);
		if (/^\s*SSL\b/.test(after)) out.ssl = { type: 'ANY' };
		else if (/^\s*X509\b/.test(after)) out.ssl = { type: 'X509' };
		else if (/^\s*NONE\b/.test(after)) out.ssl = { type: 'NONE' };
		else {
			const ssl: SslRequirement = { type: 'SPECIFIED' };
			const re = /\b(CIPHER|ISSUER|SUBJECT)\b/g;
			let m: RegExpExecArray | null;
			while ((m = re.exec(after))) {
				const l = literal(req.index + req[0].length + m.index + m[0].length);
				if (!l) continue;
				if (m[1] === 'CIPHER') ssl.cipher = l.value;
				else if (m[1] === 'ISSUER') ssl.issuer = l.value;
				else ssl.subject = l.value;
			}
			out.ssl = ssl;
		}
	}

	const withIdx = masked.search(/\bWITH\b/);
	if (withIdx >= 0) {
		const w = masked.slice(withIdx);
		if (/\bGRANT OPTION\b/.test(w)) out.grantOption = true;
		if (/\bADMIN OPTION\b/.test(w)) out.adminOption = true;
		const limits: Partial<ResourceLimits> = {};
		const lim = (re: RegExp, key: keyof ResourceLimits) => {
			const m = re.exec(w);
			if (m) limits[key] = Number(m[1]);
		};
		lim(/\bMAX_QUERIES_PER_HOUR (\d+)/, 'maxQuestions');
		lim(/\bMAX_CONNECTIONS_PER_HOUR (\d+)/, 'maxConnections');
		lim(/\bMAX_UPDATES_PER_HOUR (\d+)/, 'maxUpdates');
		lim(/\bMAX_USER_CONNECTIONS (\d+)/, 'maxUserConnections');
		if (Object.keys(limits).length) out.limits = limits;
	}
	return out;
}

const upsert = <T>(list: T[], match: (x: T) => boolean, create: () => T): T => {
	let found = list.find(match);
	if (!found) {
		found = create();
		list.push(found);
	}
	return found;
};

const addAll = (target: string[], items: string[]) => {
	for (const i of items) if (!target.includes(i)) target.push(i);
};

/** Parse the rows of SHOW GRANTS. Unknown privileges are kept verbatim. */
export function parseShowGrants(lines: readonly string[], server: PrivServer): ParsedGrants {
	const result = emptyGrants();

	for (const line of lines) {
		try {
			if (!parseLine(line.trim(), server, result)) result.unparsed.push(line);
		} catch {
			result.unparsed.push(line);
		}
	}
	return result;
}

function parseLine(line: string, server: PrivServer, out: ParsedGrants): boolean {
	if (/^REVOKE /i.test(line)) {
		out.partialRevokes.push(line);
		return true;
	}
	if (!/^GRANT /i.test(line)) return false;
	const body = line.slice(6);

	const onIdx = findTopLevel(body, ' ON ');
	const toIdx = findTopLevel(body, ' TO ');
	if (toIdx < 0) return false;

	// Role grant: `GRANT role[, role] TO grantee [WITH ADMIN OPTION]` (no ON before TO).
	if (onIdx < 0 || toIdx < onIdx) {
		const roles = splitTopLevel(body.slice(0, toIdx));
		const tail = parseGrantTail(afterGrantee(body, toIdx + 4));
		for (const r of roles) {
			const acc = readAccount(r, 0);
			if (!acc) return false;
			out.roles.push({ role: acc.user, host: acc.host, adminOption: tail.adminOption });
		}
		return true;
	}

	const privText = body.slice(0, onIdx).trim();
	const targetToIdx = findTopLevel(body, ' TO ', onIdx + 4);
	if (targetToIdx < 0) return false;
	let targetText = body.slice(onIdx + 4, targetToIdx).trim();
	const tailText = afterGrantee(body, targetToIdx + 4);
	const tail = parseGrantTail(tailText);

	// PROXY ON user TO grantee
	if (/^PROXY$/i.test(privText)) {
		const acc = readAccount(targetText, 0);
		out.proxies.push({
			proxied: { user: acc?.user ?? '', host: acc?.host ?? '' },
			grantOption: tail.grantOption
		});
		return true;
	}

	let type: RoutineGrant['type'] | null = null;
	const typeMatch = /^(PROCEDURE|FUNCTION|PACKAGE BODY|PACKAGE|TABLE)\s+/i.exec(targetText);
	if (typeMatch) {
		const t = typeMatch[1].toUpperCase();
		if (t !== 'TABLE') type = t as RoutineGrant['type'];
		targetText = targetText.slice(typeMatch[0].length);
	}
	const obj = splitObject(targetText);
	if (!obj) return false;
	const [db, table] = obj;

	// Privilege list
	const items = splitTopLevel(privText).map((i) => parsePrivilegeItem(i, server));
	const scope: Scope =
		db === '*' ? 'global' : type ? 'routine' : table === '*' ? 'database' : 'table';
	const privileges: string[] = [];
	const columns: ColumnGrant[] = [];
	for (const it of items) {
		if (it.name === 'USAGE') continue;
		if (it.name === 'ALL PRIVILEGES') {
			addAll(privileges, allPrivilegeNames(scope === 'routine' ? 'routine' : scope, server));
		} else if (it.name === 'GRANT OPTION') {
			// MariaDB can list it explicitly in old versions
			tail.grantOption = true;
		} else if (it.columns) {
			columns.push({ privilege: it.name, columns: it.columns });
		} else {
			addAll(privileges, [it.name]);
		}
	}

	switch (scope) {
		case 'global': {
			const g = out.global;
			addAll(g.privileges, privileges);
			if (tail.grantOption) {
				const staticLine =
					privileges.length === 0 || privileges.some((p) => !isDynamicPrivilege(p));
				if (staticLine) g.grantOption = true;
				addAll(g.grantable, privileges);
			}
			// The tail only appears on the first (static) global line in MariaDB.
			const { grantOption: _g, adminOption: _a, ...rest } = tail;
			void _g;
			void _a;
			out.tail = { ...rest, ...out.tail };
			break;
		}
		case 'database': {
			const d = upsert(
				out.databases,
				(x) => x.db === db,
				() => ({ db, privileges: [], grantOption: false })
			);
			addAll(d.privileges, privileges);
			d.grantOption ||= tail.grantOption;
			break;
		}
		case 'table': {
			const t = upsert(
				out.tables,
				(x) => x.db === db && x.table === table,
				() => ({ db, table, privileges: [], columns: [], grantOption: false })
			);
			addAll(t.privileges, privileges);
			for (const c of columns) {
				const existing = t.columns.find((x) => x.privilege === c.privilege);
				if (existing) addAll(existing.columns, c.columns);
				else t.columns.push({ privilege: c.privilege, columns: [...c.columns] });
			}
			t.grantOption ||= tail.grantOption;
			break;
		}
		case 'routine': {
			const r = upsert(
				out.routines,
				(x) => x.db === db && x.routine === table && x.type === type,
				() => ({ db, routine: table, type: type!, privileges: [], grantOption: false })
			);
			addAll(r.privileges, privileges);
			r.grantOption ||= tail.grantOption;
			break;
		}
	}
	return true;
}

/** Text after the grantee in `... TO grantee <tail>`. */
function afterGrantee(body: string, from: number): string {
	const acc = readAccount(body, from);
	return acc ? body.slice(acc.end) : '';
}
