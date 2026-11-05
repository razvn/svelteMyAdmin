import { describe, expect, it } from 'vitest';
import { AUDIT_COOKIE, markActivity } from './marker.ts';

function jar() {
	const values = new Map<string, string>();
	return {
		values,
		get: (name: string) => values.get(name),
		set: (name: string, value: string) => void values.set(name, value)
	};
}

const MIN = 60_000;
const t0 = Date.UTC(2026, 10, 4, 9, 0);
const mark = (
	cookies: ReturnType<typeof jar>,
	now: number,
	who = { user: 'alice', server: '1' },
	secret = 'unit-test-secret'
) => markActivity(cookies, { secret, secure: false, idleMinutes: 30, who, now });

describe('audit session marker', () => {
	it('starts a session on the first request', () => {
		expect(mark(jar(), t0)).toBe(true);
	});

	it('same person within the idle time: same session, even across many requests', () => {
		const c = jar();
		mark(c, t0);
		expect(mark(c, t0 + 20 * MIN)).toBe(false);
		// sliding: 40 minutes after the start but only 20 after the last request
		expect(mark(c, t0 + 40 * MIN)).toBe(false);
	});

	it('after the idle time: a new session', () => {
		const c = jar();
		mark(c, t0);
		expect(mark(c, t0 + 30 * MIN)).toBe(true);
	});

	it('another person or another server: a new session', () => {
		const c = jar();
		mark(c, t0);
		expect(mark(c, t0 + MIN, { user: 'bob', server: '1' })).toBe(true);
		expect(mark(c, t0 + 2 * MIN, { user: 'bob', server: '2' })).toBe(true);
		expect(mark(c, t0 + 3 * MIN, { user: 'bob', server: '2' })).toBe(false);
	});

	it('a tampered or foreign marker: a new session', () => {
		const c = jar();
		mark(c, t0);
		const token = c.values.get(AUDIT_COOKIE)!;
		c.values.set(AUDIT_COOKIE, token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA'));
		expect(mark(c, t0 + MIN)).toBe(true);
		// sealed with another secret
		mark(c, t0 + 2 * MIN, undefined, 'other-secret');
		expect(mark(c, t0 + 3 * MIN)).toBe(true);
	});
});
