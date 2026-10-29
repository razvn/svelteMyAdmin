/**
 * Shared types of the privilege modules (client-safe, no server imports).
 * Reference: libraries/classes/Server/Privileges.php.
 */

/** What the SQL generators need to know about the server. `version` is e.g. 80404 or 110413. */
export interface PrivServer {
	isMariaDB: boolean;
	version: number;
}

export type Scope = 'global' | 'database' | 'table' | 'column' | 'routine';

/** `user`@`host`. Roles on MariaDB have no host (use {@link roleName}). */
export interface Account {
	user: string;
	host: string;
	/** MariaDB role: addressed by name only (`'role'`), its Host column is empty. */
	noHost?: boolean;
}

/** A statement to run plus its display form (secrets masked with `***`). */
export interface Stmt {
	sql: string;
	display: string;
}

export type RoutineType = 'PROCEDURE' | 'FUNCTION';

/** Where a GRANT/REVOKE applies. `db` of a database target is used verbatim (it may be a wildcard pattern). */
export type GrantTarget =
	| { scope: 'global' }
	| { scope: 'database'; db: string }
	| { scope: 'table'; db: string; table: string }
	| { scope: 'routine'; db: string; routine: string; type: RoutineType };

/** A privilege in a GRANT list: a plain name or a column-scoped one (`SELECT (a, b)`). */
export type PrivilegeItem = string | { name: string; columns: string[] };

export type SslType = 'NONE' | 'ANY' | 'X509' | 'SPECIFIED';

/** REQUIRE clause: `SPECIFIED` combines cipher / issuer / subject. */
export interface SslRequirement {
	type: SslType;
	cipher?: string;
	issuer?: string;
	subject?: string;
}

/** WITH MAX_* limits (0 = unlimited). */
export interface ResourceLimits {
	maxQuestions: number;
	maxConnections: number;
	maxUpdates: number;
	maxUserConnections: number;
}

export const NO_LIMITS: ResourceLimits = {
	maxQuestions: 0,
	maxConnections: 0,
	maxUpdates: 0,
	maxUserConnections: 0
};

export const NO_SSL: SslRequirement = { type: 'NONE' };

export const stmt = (sql: string, display: string = sql): Stmt => ({ sql, display });
