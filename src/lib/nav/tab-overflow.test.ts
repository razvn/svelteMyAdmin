import { describe, expect, it } from 'vitest';
import { fitTabs } from './tab-overflow';

describe('fitTabs', () => {
	it('shows everything when it fits', () => {
		expect(fitTabs([50, 50, 50], 160, 40)).toBe(3);
	});
	it('reserves room for the More button', () => {
		// 3 tabs = 50*3 + 2*4 = 158 > 150 -> More(40) + 4 + 50 + 4 + 50 = 148 fits two
		expect(fitTabs([50, 50, 50], 150, 40)).toBe(2);
		expect(fitTabs([50, 50, 50], 100, 40)).toBe(1);
	});
	it('can show none on very narrow screens', () => {
		expect(fitTabs([50, 50], 30, 40)).toBe(0);
		expect(fitTabs([], 0, 40)).toBe(0);
	});
});
