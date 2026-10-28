/**
 * How many tabs fit in `available` pixels? When not all fit, room for a "More" button of
 * `moreWidth` is reserved. `gap` is the space between items.
 */
export function fitTabs(widths: number[], available: number, moreWidth: number, gap = 4): number {
	const total = widths.reduce((sum, w) => sum + w, 0) + gap * Math.max(0, widths.length - 1);
	if (total <= available) return widths.length;
	let used = moreWidth;
	let count = 0;
	for (const w of widths) {
		if (used + gap + w > available) break;
		used += gap + w;
		count++;
	}
	return count;
}
