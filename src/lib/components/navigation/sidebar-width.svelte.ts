export const SIDEBAR_WIDTH_KEY = 'sma.sidebar.width';
export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 640;

export const clampWidth = (px: number): number =>
	Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, Math.round(px)));

/** Resizable sidebar width, remembered in localStorage (which may be unavailable). */
export class SidebarWidth {
	value = $state(240);

	constructor(initial = 240) {
		this.value = clampWidth(initial);
	}

	/** Apply the stored width (call on mount; localStorage does not exist during SSR). */
	restore(): void {
		try {
			const raw = localStorage.getItem(SIDEBAR_WIDTH_KEY);
			const stored = raw === null ? NaN : Number(raw);
			if (Number.isFinite(stored)) this.value = clampWidth(stored);
		} catch {
			// storage blocked: keep the configured width
		}
	}

	set(px: number): void {
		this.value = clampWidth(px);
	}

	save(): void {
		try {
			localStorage.setItem(SIDEBAR_WIDTH_KEY, String(this.value));
		} catch {
			// storage blocked or full: width just is not remembered
		}
	}
}
