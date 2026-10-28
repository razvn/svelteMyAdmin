import { describe, expect, it } from 'vitest';
import { engineSupportVariant, pluginStatusVariant } from './badges.ts';

describe('engineSupportVariant', () => {
	it('maps the SHOW ENGINES support column to a badge variant', () => {
		expect(engineSupportVariant('DEFAULT')).toBe('default');
		expect(engineSupportVariant('YES')).toBe('secondary');
		expect(engineSupportVariant('DISABLED')).toBe('destructive');
		expect(engineSupportVariant('NO')).toBe('outline');
		expect(engineSupportVariant('')).toBe('outline');
	});
});

describe('pluginStatusVariant', () => {
	it('marks active plugins and flags the others', () => {
		expect(pluginStatusVariant('ACTIVE')).toBe('secondary');
		expect(pluginStatusVariant('DISABLED')).toBe('destructive');
		expect(pluginStatusVariant('NOT INSTALLED')).toBe('destructive');
	});
});
