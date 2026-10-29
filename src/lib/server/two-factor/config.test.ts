import { describe, expect, it } from 'vitest';
import {
	allBackends,
	availableBackends,
	effectiveBackend,
	readTwoFactorConfig,
	requiresSecondFactor,
	withTwoFactorConfig
} from './config.ts';
import { isPublicPath, isTwoFactorPending, twoFactorRedirect } from './gate.ts';
import { AttemptLimiter } from './rate-limit.ts';
import { openState, sealState } from './state.ts';
import { readWebAuthnSettings, relyingParty } from './webauthn.ts';
import { openSession, sealSession } from '../auth/session.ts';

describe('2fa settings JSON (phpMyAdmin layout)', () => {
	it('reads what phpMyAdmin writes', () => {
		const stored = JSON.parse(
			'{"2fa":{"backend":"application","settings":{"secret":"ABCD"}},"lang":"en"}'
		);
		expect(readTwoFactorConfig(stored)).toEqual({
			backend: 'application',
			settings: { secret: 'ABCD' }
		});
	});
	it('tolerates missing or malformed entries', () => {
		expect(readTwoFactorConfig({})).toEqual({ backend: '', settings: {} });
		expect(readTwoFactorConfig({ '2fa': 'x' })).toEqual({ backend: '', settings: {} });
		expect(readTwoFactorConfig({ '2fa': { backend: 3, settings: [] } })).toEqual({
			backend: '',
			settings: {}
		});
		// PHP encodes empty settings as []
		expect(readTwoFactorConfig(JSON.parse('{"2fa":{"backend":"","settings":[]}}'))).toEqual({
			backend: '',
			settings: {}
		});
	});
	it('round-trips through JSON and keeps other preferences', () => {
		const cfg = { backend: 'application', settings: { secret: 'XYZ' } };
		const prefs = withTwoFactorConfig({ lang: 'en', 'Export/format': 'csv' }, cfg);
		const back = JSON.parse(JSON.stringify(prefs));
		expect(readTwoFactorConfig(back)).toEqual(cfg);
		expect(back.lang).toBe('en');
		expect(back['Export/format']).toBe('csv');
	});
	it('writes empty settings as [] like json_encode', () => {
		const json = JSON.stringify(withTwoFactorConfig({}, { backend: '', settings: {} }));
		expect(json).toBe('{"2fa":{"backend":"","settings":[]}}');
	});
	it('decides when a second factor is required', () => {
		expect(requiresSecondFactor({ backend: '', settings: {} })).toBe(false);
		expect(requiresSecondFactor({ backend: 'key', settings: {} })).toBe(true);
	});
});

describe('backends', () => {
	it('offers simple only with DBG.simple2fa', () => {
		expect(availableBackends({ simple2fa: false })).toEqual(['application', 'WebAuthn']);
		expect(availableBackends({ simple2fa: true })).toEqual(['simple', 'application', 'WebAuthn']);
	});
	it('maps unknown stored backends to invalid', () => {
		const av = availableBackends({ simple2fa: false });
		expect(effectiveBackend('', av)).toBe('');
		expect(effectiveBackend('application', av)).toBe('application');
		expect(effectiveBackend('key', av)).toBe('invalid');
		expect(effectiveBackend('simple', av)).toBe('invalid');
		expect(allBackends(av).map((b) => b.id)).toEqual(['', 'application', 'WebAuthn']);
	});
});

describe('webauthn settings', () => {
	it('keeps only well-formed credentials', () => {
		const s = readWebAuthnSettings({
			userHandle: 'h',
			credentials: {
				ok: { publicKeyCredentialId: 'id', credentialPublicKey: 'k', counter: '3' },
				bad: { publicKeyCredentialId: '' },
				worse: 1
			}
		});
		expect(Object.keys(s.credentials)).toEqual(['ok']);
		expect(s.credentials.ok.counter).toBe(3);
		expect(readWebAuthnSettings({})).toEqual({ userHandle: '', credentials: {} });
	});
	it('derives the relying party from PmaAbsoluteUri or the request', () => {
		const url = new URL('http://localhost:4173/login/2fa');
		expect(relyingParty(url, '')).toMatchObject({
			id: 'localhost',
			origin: 'http://localhost:4173'
		});
		expect(relyingParty(url, 'https://db.example/pma/')).toMatchObject({
			id: 'db.example',
			origin: 'https://db.example'
		});
	});
});

describe('session gating', () => {
	it('treats only an explicit false as pending', () => {
		expect(isTwoFactorPending(null)).toBe(false);
		expect(isTwoFactorPending({})).toBe(false);
		expect(isTwoFactorPending({ twoFactorVerified: true })).toBe(false);
		expect(isTwoFactorPending({ twoFactorVerified: false })).toBe(true);
	});
	it('lets login, logout and assets through', () => {
		for (const p of ['/login', '/login/2fa', '/logout', '/api/health', '/_app/x.js']) {
			expect(isPublicPath(p)).toBe(true);
			expect(twoFactorRedirect(true, 'GET', p, '')).toBeNull();
		}
		expect(isPublicPath('/loginx')).toBe(false);
	});
	it('sends everything else to /login/2fa while pending', () => {
		expect(twoFactorRedirect(true, 'GET', '/server/settings', '?a=1')).toBe(
			'/login/2fa?redirect=%2Fserver%2Fsettings%3Fa%3D1'
		);
		expect(twoFactorRedirect(true, 'POST', '/db/x/sql', '')).toBe('/login/2fa');
		expect(twoFactorRedirect(true, 'GET', '/', '')).toBe('/login/2fa');
		expect(twoFactorRedirect(false, 'GET', '/server/settings', '')).toBeNull();
	});
	it('persists the flag in the sealed session', () => {
		const base = {
			serverIndex: 1,
			user: 'u',
			password: 'p',
			createdAt: Date.now(),
			lastActivity: Date.now()
		};
		const open = (extra: object) =>
			openSession(sealSession({ ...base, ...extra }, 'secret'), 'secret', 1000);
		expect(open({ twoFactorVerified: false })?.twoFactorVerified).toBe(false);
		expect(open({ twoFactorVerified: true })?.twoFactorVerified).toBe(true);
		expect(open({})?.twoFactorVerified).toBeUndefined();
	});
});

describe('AttemptLimiter', () => {
	it('blocks after max failures until the window passes and resets on success', () => {
		let t = 1_000_000;
		const l = new AttemptLimiter(3, 60_000, () => t);
		expect(l.retryAfter('a')).toBe(0);
		l.fail('a');
		l.fail('a');
		expect(l.retryAfter('a')).toBe(0);
		l.fail('a');
		expect(l.retryAfter('a')).toBe(60);
		expect(l.retryAfter('b')).toBe(0);
		t += 59_000;
		expect(l.retryAfter('a')).toBe(1);
		t += 2_000;
		expect(l.retryAfter('a')).toBe(0);
		l.fail('a');
		l.fail('a');
		l.fail('a');
		l.reset('a');
		expect(l.retryAfter('a')).toBe(0);
	});
});

describe('sealed step state', () => {
	it('opens for the same kind/user/server and refuses otherwise', () => {
		const tok = sealState('s', 'setup', 'alice', 1, { secret: 'X' }, 1000);
		expect(openState('s', 'setup', tok, 'alice', 1, 2000)).toEqual({ secret: 'X' });
		expect(openState('s', 'setup', tok, 'bob', 1, 2000)).toBeNull();
		expect(openState('s', 'setup', tok, 'alice', 2, 2000)).toBeNull();
		expect(openState('s', 'login', tok, 'alice', 1, 2000)).toBeNull();
		expect(openState('other', 'setup', tok, 'alice', 1, 2000)).toBeNull();
		expect(openState('s', 'setup', tok, 'alice', 1, 1000 + 11 * 60_000)).toBeNull();
		expect(openState('s', 'setup', undefined, 'alice', 1)).toBeNull();
	});
});
