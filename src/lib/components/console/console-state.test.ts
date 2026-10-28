import { describe, expect, it } from 'vitest';
import { clampHeight, DEFAULT_CONSOLE_HEIGHT, parseStored } from './console-state.svelte.ts';

describe('console persistence', () => {
	it('falls back to the defaults', () => {
		expect(parseStored(null)).toEqual({
			open: false,
			height: DEFAULT_CONSOLE_HEIGHT,
			tab: 'console'
		});
		expect(parseStored('not json')).toEqual(parseStored(null));
		expect(parseStored('{"open":"yes","height":"x","tab":"nope"}')).toEqual(parseStored(null));
	});
	it('reads a stored state', () => {
		expect(parseStored('{"open":true,"height":410,"tab":"history"}')).toEqual({
			open: true,
			height: 410,
			tab: 'history'
		});
	});
	it('clamps the height', () => {
		expect(clampHeight(10)).toBe(160);
		expect(clampHeight(900, 500)).toBe(500);
	});
});
