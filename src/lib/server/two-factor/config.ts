import { N_ } from '#lib/i18n/index.ts';
/**
 * The `2fa` entry of the user's preferences (`pma__userconfig.config_data`), exactly the structure of
 * phpMyAdmin's TwoFactor::readConfig / save: `{"backend": "<id>", "settings": {...}}`.
 *
 * Backend ids are phpMyAdmin's: `''` (none), `application` (TOTP), `WebAuthn`, `simple` (DBG.simple2fa).
 * The legacy FIDO U2F backend `key` is not implemented: a stored `key` is treated as `invalid`, like
 * phpMyAdmin does for a backend it cannot load.
 */
import type { PrefData } from '#lib/preferences/logic.ts';

export interface TwoFactorConfig {
	backend: string;
	settings: Record<string, unknown>;
}

export const NO_TWO_FACTOR: TwoFactorConfig = { backend: '', settings: {} };

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** TwoFactor::readConfig: tolerant of missing/invalid parts (PHP `[]` for empty settings is an array). */
export function readTwoFactorConfig(prefs: PrefData): TwoFactorConfig {
	const raw = prefs['2fa'];
	if (!isObject(raw)) return { backend: '', settings: {} };
	const backend = typeof raw.backend === 'string' ? raw.backend : '';
	const settings = isObject(raw.settings) ? raw.settings : {};
	return { backend, settings };
}

/** Prefs with the `2fa` entry replaced; settings serialize as `[]` when empty (PHP json_encode). */
export function withTwoFactorConfig(prefs: PrefData, cfg: TwoFactorConfig): PrefData {
	return {
		...prefs,
		'2fa': {
			backend: cfg.backend,
			settings: Object.keys(cfg.settings).length === 0 ? [] : cfg.settings
		}
	};
}

export interface BackendInfo {
	id: string;
	name: string;
	description: string;
}

export const BACKENDS: Record<string, BackendInfo> = {
	'': {
		id: '',
		name: N_('No Two-Factor Authentication'),
		description: N_('Login using password only.')
	},
	application: {
		id: 'application',
		name: N_('Authentication Application (2FA)'),
		description: N_(
			'Provides authentication using HOTP and TOTP applications such as FreeOTP, Google Authenticator or Authy.'
		)
	},
	WebAuthn: {
		id: 'WebAuthn',
		name: N_('Hardware Security Key (WebAuthn/FIDO2)'),
		description: N_(
			'Provides authentication using hardware security tokens supporting the WebAuthn/FIDO2 protocol, such as a YubiKey.'
		)
	},
	simple: {
		id: 'simple',
		name: N_('Simple two-factor authentication'),
		description: N_('For testing purposes only!')
	},
	invalid: {
		id: 'invalid',
		name: N_('Invalid two-factor authentication'),
		description: N_('Error fallback only!')
	}
};

/** TwoFactor::getAvailableBackends. */
export function availableBackends(dbg: { simple2fa: boolean }): string[] {
	return [...(dbg.simple2fa ? ['simple'] : []), 'application', 'WebAuthn'];
}

/** TwoFactor::getBackendClass: configured backend id -> the plugin that handles it. */
export function effectiveBackend(name: string, available: readonly string[]): string {
	if (name === '') return '';
	return available.includes(name) ? name : 'invalid';
}

/** All choices of the configure form (TwoFactor::getAllBackends), `none` first. */
export function allBackends(available: readonly string[]): BackendInfo[] {
	return ['', ...available].map((id) => BACKENDS[id]);
}

/** Whether the second factor is required to log in. */
export function requiresSecondFactor(cfg: TwoFactorConfig): boolean {
	return cfg.backend !== '';
}
