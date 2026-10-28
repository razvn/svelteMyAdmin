import { describe, expect, it } from 'vitest';
import { engineSupportVariant, pluginStatusVariant, yesNoVariant } from './badges.ts';

describe('engineSupportVariant', () => {
	it('maps the SHOW ENGINES support column to a badge variant', () => {
		expect(engineSupportVariant('DEFAULT')).toBe('primary');
		expect(engineSupportVariant('YES')).toBe('success');
		expect(engineSupportVariant('DISABLED')).toBe('destructive');
		expect(engineSupportVariant('NO')).toBe('muted');
		expect(engineSupportVariant('')).toBe('muted');
	});
});

describe('pluginStatusVariant', () => {
	it('marks active plugins green and flags the others', () => {
		expect(pluginStatusVariant('ACTIVE')).toBe('success');
		expect(pluginStatusVariant('DISABLED')).toBe('destructive');
		expect(pluginStatusVariant('NOT INSTALLED')).toBe('warning');
	});
});

describe('yesNoVariant', () => {
	it('colours only YES', () => {
		expect(yesNoVariant('YES')).toBe('success');
		expect(yesNoVariant('NO')).toBe('muted');
		expect(yesNoVariant(null)).toBe('muted');
	});
});
