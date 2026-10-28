import type { Component } from 'svelte';
import Archive from '@lucide/svelte/icons/archive';
import Blocks from '@lucide/svelte/icons/blocks';
import CalendarClock from '@lucide/svelte/icons/calendar-clock';
import Cog from '@lucide/svelte/icons/cog';
import Columns3 from '@lucide/svelte/icons/columns-3';
import Cpu from '@lucide/svelte/icons/cpu';
import Database from '@lucide/svelte/icons/database';
import Eye from '@lucide/svelte/icons/eye';
import FileDown from '@lucide/svelte/icons/file-down';
import FileUp from '@lucide/svelte/icons/file-up';
import Languages from '@lucide/svelte/icons/languages';
import ListChecks from '@lucide/svelte/icons/list-checks';
import Network from '@lucide/svelte/icons/network';
import PlugZap from '@lucide/svelte/icons/plug-zap';
import Rows3 from '@lucide/svelte/icons/rows-3';
import Search from '@lucide/svelte/icons/search';
import Settings from '@lucide/svelte/icons/settings';
import SquarePen from '@lucide/svelte/icons/square-pen';
import SquareTerminal from '@lucide/svelte/icons/square-terminal';
import Table2 from '@lucide/svelte/icons/table-2';
import Users from '@lucide/svelte/icons/users';
import Variable from '@lucide/svelte/icons/variable';
import Wrench from '@lucide/svelte/icons/wrench';
import Zap from '@lucide/svelte/icons/zap';
import Activity from '@lucide/svelte/icons/activity';
import FunctionSquare from '@lucide/svelte/icons/square-function';
import GitBranch from '@lucide/svelte/icons/git-branch';

/** Tab id -> icon. Unknown ids fall back to no icon. */
export const TAB_ICONS: Record<string, Component> = {
	databases: Database,
	sql: SquareTerminal,
	status: Activity,
	privileges: Users,
	export: FileDown,
	import: FileUp,
	settings: Settings,
	binlog: Archive,
	replication: Network,
	variables: Variable,
	charsets: Languages,
	engines: Cpu,
	plugins: PlugZap,
	structure: Table2,
	search: Search,
	query: ListChecks,
	operations: Wrench,
	routines: FunctionSquare,
	events: CalendarClock,
	triggers: Zap,
	tracking: Eye,
	designer: GitBranch,
	'central-columns': Columns3,
	browse: Rows3,
	insert: SquarePen
};

export const FALLBACK_ICON: Component = Blocks;
export const MORE_ICON: Component = Cog;
