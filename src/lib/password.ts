/** Password helpers for the account forms (strength meter and generator). Pure and client-safe. */

export const STRENGTH_LABELS = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong'] as const;

/**
 * 0 (very weak) .. 4 (strong), a lightweight stand-in for phpMyAdmin's zxcvbn meter: length and character
 * variety, with penalties for repetition and for containing the user name.
 */
export function passwordStrength(password: string, userName = ''): number {
	if (password === '') return 0;
	let score = 0;
	if (password.length >= 8) score++;
	if (password.length >= 12) score++;
	const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
	if (classes >= 3) score++;
	if (classes === 4 && password.length >= 10) score++;
	if (new Set(password).size <= Math.max(2, password.length / 4)) score = Math.min(score, 1);
	if (userName.length >= 3 && password.toLowerCase().includes(userName.toLowerCase())) {
		score = Math.min(score, 1);
	}
	return Math.max(0, Math.min(4, score));
}

const LOWER = 'abcdefghijkmnopqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!#$%&*+-=?@^_';

/** A random password containing every character class (phpMyAdmin generates 16 characters). */
export function generatePassword(
	length = 16,
	random: (max: number) => number = (max) => {
		const buf = new Uint32Array(1);
		// Rejection sampling keeps the distribution uniform.
		const limit = Math.floor(0x100000000 / max) * max;
		do crypto.getRandomValues(buf);
		while (buf[0] >= limit);
		return buf[0] % max;
	}
): string {
	const pools = [LOWER, UPPER, DIGITS, SYMBOLS];
	const all = pools.join('');
	const chars = pools.map((p) => p[random(p.length)]);
	while (chars.length < length) chars.push(all[random(all.length)]);
	for (let i = chars.length - 1; i > 0; i--) {
		const j = random(i + 1);
		[chars[i], chars[j]] = [chars[j], chars[i]];
	}
	return chars.join('');
}
