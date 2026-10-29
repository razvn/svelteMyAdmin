import { describe, expect, it } from 'vitest';
import { generatePassword, passwordStrength } from './password.ts';

describe('passwordStrength', () => {
	it('scores from very weak to strong', () => {
		expect(passwordStrength('')).toBe(0);
		expect(passwordStrength('abc')).toBe(0);
		expect(passwordStrength('abcdefgh')).toBe(1);
		expect(passwordStrength('Abcdefg1')).toBe(2);
		expect(passwordStrength('Abcdefghij1k')).toBe(3);
		expect(passwordStrength('Abcdefghij1k!')).toBe(4);
	});

	it('punishes repetition and the user name', () => {
		expect(passwordStrength('aaaaaaaaaaaaaaaa')).toBe(1);
		expect(passwordStrength('Johnny-Pass-123!', 'johnny')).toBe(1);
		expect(passwordStrength('Johnny-Pass-123!', 'x')).toBe(4);
	});
});

describe('generatePassword', () => {
	it('has the requested length and all character classes', () => {
		for (let i = 0; i < 50; i++) {
			const pw = generatePassword(16);
			expect(pw).toHaveLength(16);
			expect(pw).toMatch(/[a-z]/);
			expect(pw).toMatch(/[A-Z]/);
			expect(pw).toMatch(/\d/);
			expect(pw).toMatch(/[^A-Za-z0-9]/);
		}
	});

	it('is deterministic for a fixed random source and varies for the real one', () => {
		let n = 0;
		const fixed = (max: number) => n++ % max;
		n = 0;
		const a = generatePassword(12, fixed);
		n = 0;
		expect(generatePassword(12, fixed)).toBe(a);
		expect(new Set(Array.from({ length: 20 }, () => generatePassword())).size).toBe(20);
	});
});
