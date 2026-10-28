import { createContext } from 'svelte';
import type { ScriptResult } from '#lib/sql/run-types.ts';

export const CONSOLE_KEY = 'sma.console';
export const MIN_CONSOLE_HEIGHT = 160;
export const DEFAULT_CONSOLE_HEIGHT = 320;
const MAX_RUNS = 20;

export type ConsoleTab = 'console' | 'history' | 'bookmarks';

export interface ConsoleRun {
	id: number;
	sql: string;
	db: string;
	table: string;
	/** null when the request itself failed. */
	result: ScriptResult | null;
	error: string;
}

export const clampHeight = (px: number, max = 4000): number =>
	Math.min(Math.max(MIN_CONSOLE_HEIGHT, max), Math.max(MIN_CONSOLE_HEIGHT, Math.round(px)));

/** Parse the persisted value; anything unexpected gives the defaults. */
export function parseStored(raw: string | null): {
	open: boolean;
	height: number;
	tab: ConsoleTab;
} {
	const out = { open: false, height: DEFAULT_CONSOLE_HEIGHT, tab: 'console' as ConsoleTab };
	if (!raw) return out;
	try {
		const v = JSON.parse(raw) as Record<string, unknown>;
		if (v.open === true) out.open = true;
		if (typeof v.height === 'number' && Number.isFinite(v.height))
			out.height = clampHeight(v.height);
		if (v.tab === 'history' || v.tab === 'bookmarks' || v.tab === 'console') out.tab = v.tab;
	} catch {
		// corrupt value: defaults
	}
	return out;
}

/** SQL console drawer state: open flag, height and tab persist in localStorage (which may be blocked). */
export class ConsoleState {
	open = $state(false);
	height = $state(DEFAULT_CONSOLE_HEIGHT);
	tab = $state<ConsoleTab>('console');
	input = $state('');
	runs = $state.raw<ConsoleRun[]>([]);
	/** Bumped after every run so the history list refetches. */
	historyKey = $state(0);
	#nextId = 1;

	restore(): void {
		try {
			const s = parseStored(localStorage.getItem(CONSOLE_KEY));
			this.open = s.open;
			this.height = s.height;
			this.tab = s.tab;
		} catch {
			// storage blocked
		}
	}

	save(): void {
		try {
			localStorage.setItem(
				CONSOLE_KEY,
				JSON.stringify({ open: this.open, height: this.height, tab: this.tab })
			);
		} catch {
			// storage blocked or full
		}
	}

	toggle(): void {
		this.open = !this.open;
		this.save();
	}

	setOpen(open: boolean): void {
		this.open = open;
		this.save();
	}

	setTab(tab: ConsoleTab): void {
		this.tab = tab;
		this.save();
	}

	setHeight(px: number, max?: number): void {
		this.height = clampHeight(px, max);
	}

	addRun(run: Omit<ConsoleRun, 'id'>): void {
		this.runs = [...this.runs, { ...run, id: this.#nextId++ }].slice(-MAX_RUNS);
		this.historyKey++;
	}

	clearRuns(): void {
		this.runs = [];
	}
}

export const [getConsoleState, setConsoleState] = createContext<ConsoleState>();
