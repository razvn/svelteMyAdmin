/**
 * Privilege catalogue: every privilege phpMyAdmin (Privileges::getGrantsArray / getTableGrantsArray and the
 * privileges_table.twig template) knows about plus the MySQL 8 dynamic and MariaDB specific ones, with the
 * scopes they can be granted at, their group in the grid, their descriptions and the server versions that
 * have them. `name` is the keyword used by GRANT/REVOKE and reported by SHOW GRANTS.
 */
import { N_ } from '#lib/i18n/index.ts';
import type { PrivServer, Scope } from './types.ts';

/** Grid groups. `dynamic` = MySQL 8 dynamic privileges (global only). */
export type PrivGroup = 'data' | 'structure' | 'administration' | 'dynamic';

export const GROUP_LABELS: Record<PrivGroup, string> = {
	data: N_('Data'),
	structure: N_('Structure'),
	administration: N_('Administration'),
	dynamic: N_('Dynamic privileges')
};

export interface PrivilegeDef {
	name: string;
	/** `mysql.user` column (Y/N) when the privilege has one. */
	column?: string;
	description: string;
	/** Description override per scope (e.g. CREATE: "databases and tables" only at global level). */
	scopeDescriptions?: Partial<Record<Scope, string>>;
	group: PrivGroup;
	scopes: readonly Scope[];
	/** Only on this server flavour. */
	engine?: 'mysql' | 'mariadb';
	/** First version (inclusive) that has it, e.g. 100502. */
	since?: number;
	/** First version that no longer offers it (exclusive upper bound). */
	until?: number;
	/** Dynamic privileges are never part of ALL PRIVILEGES in SHOW GRANTS. */
	dynamic?: boolean;
}

const G: Scope = 'global';
const D: Scope = 'database';
const T: Scope = 'table';
const C: Scope = 'column';
const R: Scope = 'routine';

type Opts = Partial<
	Pick<PrivilegeDef, 'column' | 'scopeDescriptions' | 'engine' | 'since' | 'until' | 'dynamic'>
>;

const def = (
	name: string,
	group: PrivGroup,
	scopes: Scope[],
	description: string,
	opts: Opts = {}
): PrivilegeDef => ({ name, group, scopes, description, ...opts });

const REPL_MONITOR = 100502;

const STATIC: PrivilegeDef[] = [
	// Data
	def('SELECT', 'data', [G, D, T, C], N_('Allows reading data.'), { column: 'Select_priv' }),
	def('INSERT', 'data', [G, D, T, C], N_('Allows inserting and replacing data.'), {
		column: 'Insert_priv'
	}),
	def('UPDATE', 'data', [G, D, T, C], N_('Allows changing data.'), { column: 'Update_priv' }),
	def('DELETE', 'data', [G, D, T], N_('Allows deleting data.'), { column: 'Delete_priv' }),
	def('FILE', 'data', [G], N_('Allows importing data from and exporting data into files.'), {
		column: 'File_priv'
	}),
	def('DELETE HISTORY', 'data', [G, D, T], N_('Allows deleting historical rows.'), {
		column: 'Delete_history_priv',
		engine: 'mariadb',
		since: 100304
	}),
	// Structure
	def('CREATE', 'structure', [G, D, T], N_('Allows creating new tables.'), {
		column: 'Create_priv',
		scopeDescriptions: { global: N_('Allows creating new databases and tables.') }
	}),
	def('ALTER', 'structure', [G, D, T], N_('Allows altering the structure of existing tables.'), {
		column: 'Alter_priv'
	}),
	def('INDEX', 'structure', [G, D, T], N_('Allows creating and dropping indexes.'), {
		column: 'Index_priv'
	}),
	def('DROP', 'structure', [G, D, T], N_('Allows dropping tables.'), {
		column: 'Drop_priv',
		scopeDescriptions: { global: N_('Allows dropping databases and tables.') }
	}),
	def('CREATE TEMPORARY TABLES', 'structure', [G, D], N_('Allows creating temporary tables.'), {
		column: 'Create_tmp_table_priv'
	}),
	def('SHOW VIEW', 'structure', [G, D, T], N_('Allows performing SHOW CREATE VIEW queries.'), {
		column: 'Show_view_priv'
	}),
	def('CREATE ROUTINE', 'structure', [G, D], N_('Allows creating stored routines.'), {
		column: 'Create_routine_priv'
	}),
	def('ALTER ROUTINE', 'structure', [G, D, R], N_('Allows altering and dropping stored routines.'), {
		column: 'Alter_routine_priv'
	}),
	def('EXECUTE', 'structure', [G, D, R], N_('Allows executing stored routines.'), {
		column: 'Execute_priv'
	}),
	def('CREATE VIEW', 'structure', [G, D, T], N_('Allows creating new views.'), {
		column: 'Create_view_priv'
	}),
	def('EVENT', 'structure', [G, D], N_('Allows to set up events for the event scheduler.'), {
		column: 'Event_priv'
	}),
	def('TRIGGER', 'structure', [G, D, T], N_('Allows creating and dropping triggers.'), {
		column: 'Trigger_priv'
	}),
	def(
		'SHOW CREATE ROUTINE',
		'structure',
		[G, D, R],
		N_('Allows performing SHOW CREATE PROCEDURE / FUNCTION queries.'),
		{ engine: 'mariadb', since: 110300 }
	),
	// Administration
	def(
		'SUPER',
		'administration',
		[G],
		N_('Allows connecting, even if maximum number of connections is reached; required for most administrative operations like setting global variables or killing threads of other users.'),
		{ column: 'Super_priv' }
	),
	def('PROCESS', 'administration', [G], N_('Allows viewing processes of all users.'), {
		column: 'Process_priv'
	}),
	def(
		'RELOAD',
		'administration',
		[G],
		N_("Allows reloading server settings and flushing the server's caches."),
		{ column: 'Reload_priv' }
	),
	def('SHUTDOWN', 'administration', [G], N_('Allows shutting down the server.'), {
		column: 'Shutdown_priv'
	}),
	def('SHOW DATABASES', 'administration', [G], N_('Gives access to the complete list of databases.'), {
		column: 'Show_db_priv'
	}),
	def('LOCK TABLES', 'administration', [G, D], N_('Allows locking tables for the current thread.'), {
		column: 'Lock_tables_priv'
	}),
	def('REFERENCES', 'administration', [G, D, T, C], N_('Allows creating foreign key relations.'), {
		column: 'References_priv',
		scopeDescriptions: {}
	}),
	def(
		'REPLICATION CLIENT',
		'administration',
		[G],
		N_('Allows the user to ask where the replicas / primaries are.'),
		{ column: 'Repl_client_priv' }
	),
	def('REPLICATION SLAVE', 'administration', [G], N_('Needed for the replication replicas.'), {
		column: 'Repl_slave_priv'
	}),
	def(
		'CREATE USER',
		'administration',
		[G],
		N_('Allows creating, dropping and renaming user accounts.'),
		{
			column: 'Create_user_priv'
		}
	),
	def(
		'CREATE TABLESPACE',
		'administration',
		[G],
		N_('Allows creating, altering and dropping tablespaces.'),
		{
			column: 'Create_tablespace_priv'
		}
	),
	def('CREATE ROLE', 'administration', [G], N_('Allows creating roles.'), {
		engine: 'mysql',
		since: 80000
	}),
	def('DROP ROLE', 'administration', [G], N_('Allows dropping roles.'), {
		engine: 'mysql',
		since: 80000
	}),
	// MariaDB 10.5.2+ administrative privileges (REPLICATION CLIENT became BINLOG MONITOR)
	def('BINLOG ADMIN', 'administration', [G], N_('Allows purging binary logs (PURGE BINARY LOGS).'), {
		engine: 'mariadb',
		since: REPL_MONITOR
	}),
	def('BINLOG MONITOR', 'administration', [G], N_('Allows SHOW BINLOG STATUS and SHOW BINARY LOGS.'), {
		engine: 'mariadb',
		since: REPL_MONITOR
	}),
	def('BINLOG REPLAY', 'administration', [G], N_('Allows executing BINLOG statements.'), {
		engine: 'mariadb',
		since: REPL_MONITOR
	}),
	def(
		'CONNECTION ADMIN',
		'administration',
		[G],
		N_("Allows bypassing connection limits and killing other users' connections."),
		{ engine: 'mariadb', since: REPL_MONITOR }
	),
	def(
		'FEDERATED ADMIN',
		'administration',
		[G],
		N_('Allows CREATE SERVER, ALTER SERVER and DROP SERVER.'),
		{ engine: 'mariadb', since: REPL_MONITOR }
	),
	def(
		'READ_ONLY ADMIN',
		'administration',
		[G],
		N_('Allows write operations even if @@read_only is ON.'),
		{ engine: 'mariadb', since: REPL_MONITOR }
	),
	def(
		'REPLICATION MASTER ADMIN',
		'administration',
		[G],
		N_('Allows monitoring connected replicas (SHOW SLAVE HOSTS).'),
		{ engine: 'mariadb', since: REPL_MONITOR }
	),
	def(
		'REPLICATION SLAVE ADMIN',
		'administration',
		[G],
		N_('Allows starting and stopping replication and applying binary log events.'),
		{ engine: 'mariadb', since: REPL_MONITOR }
	),
	def(
		'SET USER',
		'administration',
		[G],
		N_('Allows creating views and stored routines with a different definer.'),
		{
			engine: 'mariadb',
			since: REPL_MONITOR
		}
	),
	def(
		'SLAVE MONITOR',
		'administration',
		[G],
		N_('Allows SHOW SLAVE STATUS and SHOW RELAYLOG EVENTS.'),
		{ engine: 'mariadb', since: REPL_MONITOR }
	)
];

const dyn = (name: string, since: number, description: string, until?: number): PrivilegeDef => ({
	name,
	group: 'dynamic',
	scopes: [G],
	description,
	engine: 'mysql',
	since,
	dynamic: true,
	...(until ? { until } : {})
});

/** MySQL 8 dynamic privileges (SHOW PRIVILEGES on 8.4, with the release that introduced them). */
const DYNAMIC: PrivilegeDef[] = [
	dyn(
		'ALLOW_NONEXISTENT_DEFINER',
		80200,
		N_('Allows creating objects with a definer that does not exist.')
	),
	dyn('APPLICATION_PASSWORD_ADMIN', 80014, N_('Allows managing dual passwords.')),
	dyn('AUDIT_ABORT_EXEMPT', 80028, N_('Exempts queries from being blocked by the audit log filter.')),
	dyn('AUDIT_ADMIN', 80001, N_('Allows managing the audit log.')),
	dyn('AUTHENTICATION_POLICY_ADMIN', 80027, N_('Allows managing authentication policies.')),
	dyn(
		'BACKUP_ADMIN',
		80001,
		N_('Allows running backup related statements (LOCK INSTANCE FOR BACKUP).')
	),
	dyn('BINLOG_ADMIN', 80001, N_('Allows managing the binary log (PURGE BINARY LOGS, BINLOG).')),
	dyn('BINLOG_ENCRYPTION_ADMIN', 80001, N_('Allows enabling or disabling binary log encryption.')),
	dyn('CLONE_ADMIN', 80001, N_('Allows using the clone plugin.')),
	dyn(
		'CONNECTION_ADMIN',
		80001,
		N_('Allows bypassing connection limits and killing other connections.')
	),
	dyn('ENCRYPTION_KEY_ADMIN', 80001, N_('Allows rotating InnoDB encryption keys.')),
	dyn('FIREWALL_EXEMPT', 80027, N_('Exempts the user from firewall restrictions.')),
	dyn('FLUSH_OPTIMIZER_COSTS', 80023, N_('Allows FLUSH OPTIMIZER_COSTS.')),
	dyn('FLUSH_PRIVILEGES', 80400, N_('Allows FLUSH PRIVILEGES.')),
	dyn('FLUSH_STATUS', 80023, N_('Allows FLUSH STATUS.')),
	dyn('FLUSH_TABLES', 80023, N_('Allows FLUSH TABLES.')),
	dyn('FLUSH_USER_RESOURCES', 80023, N_('Allows FLUSH USER_RESOURCES.')),
	dyn('GROUP_REPLICATION_ADMIN', 80001, N_('Allows managing Group Replication.')),
	dyn('GROUP_REPLICATION_STREAM', 80000, N_('Allows Group Replication recovery channel connections.')),
	dyn('INNODB_REDO_LOG_ARCHIVE', 80017, N_('Allows managing InnoDB redo log archiving.')),
	dyn('INNODB_REDO_LOG_ENABLE', 80021, N_('Allows enabling or disabling the InnoDB redo log.')),
	dyn('OPTIMIZE_LOCAL_TABLE', 80400, N_('Allows OPTIMIZE LOCAL TABLE.')),
	dyn(
		'PASSWORDLESS_USER_ADMIN',
		80000,
		N_('Allows managing accounts that use passwordless authentication.')
	),
	dyn('PERSIST_RO_VARIABLES_ADMIN', 80014, N_('Allows persisting read-only system variables.')),
	dyn('REPLICATION_APPLIER', 80018, N_('Allows acting as the applier of a replication channel.')),
	dyn('REPLICATION_SLAVE_ADMIN', 80001, N_('Allows starting and stopping replication.')),
	dyn('RESOURCE_GROUP_ADMIN', 80001, N_('Allows managing resource groups.')),
	dyn('RESOURCE_GROUP_USER', 80001, N_('Allows assigning threads and statements to resource groups.')),
	dyn('ROLE_ADMIN', 80001, N_('Allows granting and revoking roles, and using WITH ADMIN OPTION.')),
	dyn('SENSITIVE_VARIABLES_OBSERVER', 80029, N_('Allows viewing sensitive system variable values.')),
	dyn(
		'SERVICE_CONNECTION_ADMIN',
		80014,
		N_('Allows connecting using the administrative network interface.')
	),
	dyn('SESSION_VARIABLES_ADMIN', 80014, N_('Allows setting restricted session system variables.')),
	dyn('SET_ANY_DEFINER', 80200, N_('Allows specifying any definer when creating stored objects.')),
	dyn('SHOW_ROUTINE', 80020, N_('Allows viewing the definition of any stored routine.')),
	dyn('SYSTEM_USER', 80016, N_('Designates an account as a system user.')),
	dyn('SYSTEM_VARIABLES_ADMIN', 80001, N_('Allows setting global system variables.')),
	dyn('TABLE_ENCRYPTION_ADMIN', 80016, N_('Allows overriding default encryption settings.')),
	dyn('TELEMETRY_LOG_ADMIN', 80000, N_('Allows managing the telemetry log.')),
	dyn('TRANSACTION_GTID_TAG', 80400, N_('Allows setting GTID tags.')),
	dyn('XA_RECOVER_ADMIN', 80000, N_('Allows XA RECOVER.'))
];

export const PRIVILEGES: readonly PrivilegeDef[] = [...STATIC, ...DYNAMIC];

/** The GRANT OPTION flag: handled separately from the privilege set (WITH GRANT OPTION). */
export const GRANT_OPTION = {
	name: 'GRANT OPTION',
	column: 'Grant_priv',
	description:
		N_('Allows user to give to other users or remove from other users the privileges that user possess yourself.'),
	group: 'administration' as const,
	scopes: ['global', 'database', 'table', 'routine'] as const
};

/** Is the definition available on this server? */
export function isAvailable(p: PrivilegeDef, server: PrivServer): boolean {
	if (p.engine === 'mariadb' && !server.isMariaDB) return false;
	if (p.engine === 'mysql' && server.isMariaDB) return false;
	if (p.since !== undefined && server.version < p.since) return false;
	if (p.until !== undefined && server.version >= p.until) return false;
	// MariaDB 10.5.2 renamed REPLICATION CLIENT to BINLOG MONITOR
	if (p.name === 'REPLICATION CLIENT' && server.isMariaDB && server.version >= REPL_MONITOR) {
		return false;
	}
	return true;
}

/** Privileges that can be granted at `scope` on this server, in grid order. */
export function privilegesFor(scope: Scope, server: PrivServer): PrivilegeDef[] {
	return PRIVILEGES.filter((p) => p.scopes.includes(scope) && isAvailable(p, server));
}

/** What `GRANT ALL PRIVILEGES` stands for at `scope`: every available non-dynamic privilege. */
export function allPrivilegeNames(scope: Scope, server: PrivServer): string[] {
	return privilegesFor(scope, server)
		.filter((p) => !p.dynamic)
		.map((p) => p.name);
}

export interface PrivilegeGroup {
	group: PrivGroup;
	label: string;
	items: PrivilegeDef[];
}

/** Grid layout: Data / Structure / Administration (/ Dynamic privileges), empty groups dropped. */
export function groupedPrivileges(scope: Scope, server: PrivServer): PrivilegeGroup[] {
	const list = privilegesFor(scope, server);
	return (['data', 'structure', 'administration', 'dynamic'] as const)
		.map((group) => ({
			group,
			label: GROUP_LABELS[group],
			items: list.filter((p) => p.group === group)
		}))
		.filter((g) => g.items.length > 0);
}

/** The description shown for a privilege at a scope (REFERENCES depends on the server). */
export function describePrivilege(p: PrivilegeDef, scope: Scope, server: PrivServer): string {
	if (p.name === 'REFERENCES') {
		return server.isMariaDB ? N_('Not used on MariaDB.') : N_('Allows creating foreign key relations.');
	}
	return p.scopeDescriptions?.[scope] ?? p.description;
}

const BY_NAME = new Map(PRIVILEGES.map((p) => [p.name, p]));

export function findPrivilege(name: string): PrivilegeDef | undefined {
	return BY_NAME.get(name);
}

export function isDynamicPrivilege(name: string): boolean {
	return BY_NAME.get(name)?.dynamic === true;
}

/** Old / alternative spellings reported by SHOW GRANTS or accepted by GRANT. */
const ALIASES_ALL: Record<string, string> = {
	'DELETE VERSIONING ROWS': 'DELETE HISTORY',
	CREATE_VIEW: 'CREATE VIEW',
	SHOW_VIEW: 'SHOW VIEW',
	ALL: 'ALL PRIVILEGES'
};
const ALIASES_MARIADB: Record<string, string> = {
	'REPLICATION CLIENT': 'BINLOG MONITOR',
	'REPLICA MONITOR': 'SLAVE MONITOR',
	'REPLICATION REPLICA': 'REPLICATION SLAVE',
	'REPLICATION REPLICA ADMIN': 'REPLICATION SLAVE ADMIN'
};

/** Canonical privilege keyword: upper case, single spaces, aliases resolved for the server. */
export function normalizePrivilegeName(raw: string, server: PrivServer): string {
	let name = raw.trim().replace(/\s+/g, ' ').toUpperCase();
	name = ALIASES_ALL[name] ?? name;
	if (server.isMariaDB) {
		if (server.version >= REPL_MONITOR) name = ALIASES_MARIADB[name] ?? name;
		else name = name === 'REPLICA MONITOR' ? 'SLAVE MONITOR' : name;
	}
	return name;
}
