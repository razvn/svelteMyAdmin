import { cn } from '#lib/utils.ts';

/** Shell of a tab strip: a white rounded bar on the canvas (see docs/DESIGN.md). */
export const TAB_STRIP = 'rounded-xl border bg-card p-1 shadow-card';

/** One tab: soft indigo pill when active, muted text with a grey hover otherwise. */
export function tabLinkClass(active: boolean): string {
	return cn(
		'inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-transparent px-2.5 text-sm font-medium whitespace-nowrap transition-colors outline-none select-none focus-visible:ring-3 focus-visible:ring-ring/50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
		active
			? 'bg-primary-soft text-primary'
			: 'text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground'
	);
}
