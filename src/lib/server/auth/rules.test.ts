import { describe, expect, it } from 'vitest';
import { checkRules } from './rules';

const base = {
	AllowDeny: { order: '' as const, rules: [] },
	AllowRoot: true,
	AllowNoPassword: false
};

describe('checkRules', () => {
	it('accepts a normal login', () => {
		expect(checkRules(base, 'bob', 'pw', '1.2.3.4')).toBeNull();
	});
	it('rejects empty passwords unless AllowNoPassword', () => {
		expect(checkRules(base, 'bob', '', '1.2.3.4')).toBe('empty-denied');
		expect(checkRules({ ...base, AllowNoPassword: true }, 'bob', '', '1.2.3.4')).toBeNull();
	});
	it('rejects root unless AllowRoot', () => {
		expect(checkRules({ ...base, AllowRoot: false }, 'root', 'pw', '1.2.3.4')).toBe('root-denied');
		expect(checkRules({ ...base, AllowRoot: false }, 'bob', 'pw', '1.2.3.4')).toBeNull();
	});
	it('applies AllowDeny first', () => {
		const s = {
			...base,
			AllowDeny: { order: 'explicit' as const, rules: ['allow % from 10.0.0.0/8'] }
		};
		expect(checkRules(s, 'bob', 'pw', '10.1.1.1')).toBeNull();
		expect(checkRules(s, 'bob', 'pw', '11.1.1.1')).toBe('allow-denied');
		expect(checkRules(s, 'bob', 'pw', null)).toBe('allow-denied');
	});
});
