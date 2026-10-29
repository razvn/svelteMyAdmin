/**
 * The second-factor steps shared by the login page and the settings tab: challenge, verification, setup.
 * Mirrors TwoFactorPlugin::{render,check,setup,configure} of the phpMyAdmin backends.
 */
import type { Cookies } from '@sveltejs/kit';
import { SOURCE_TRANSLATOR, type Translator } from '#lib/i18n/translator.ts';
import QRCode from 'qrcode';
import type { AppConfig, ServerConfig } from '#lib/server/config/schema.ts';
import { availableBackends, effectiveBackend, type TwoFactorConfig } from './config.ts';
import { limiterKey, secondFactorLimiter } from './rate-limit.ts';
import { clearState, getState, setState } from './state.ts';
import { loadTwoFactor, saveTwoFactor, type OwnConnection } from './store.ts';
import { generateSecret, otpauthUri, verifyTotp } from './totp.ts';
import * as webauthn from './webauthn.ts';

export interface FlowCtx {
	server: ServerConfig;
	own: OwnConnection;
	config: Pick<AppConfig, 'blowfish_secret' | 'PmaAbsoluteUri' | 'DBG'>;
	cookies: Cookies;
	url: URL;
	user: string;
	serverIndex: number;
	/** Translator for the error messages (English when omitted). */
	i18n?: Translator;
}

export type { ChallengeView, SetupView } from '#lib/two-factor/types.ts';
import type { ChallengeView, SetupView } from '#lib/two-factor/types.ts';

export type CheckResult = { ok: true } | { ok: false; error: string };

const failedText = (ctx: FlowCtx, message = ''): string => {
	const { t } = ctx.i18n ?? SOURCE_TRANSLATOR;
	return message
		? t('Two-factor authentication failed: {message}', { message })
		: t('Two-factor authentication failed.');
};
const tooMany = (ctx: FlowCtx, wait: number): string =>
	(ctx.i18n ?? SOURCE_TRANSLATOR).tn(
		'Too many failed attempts. Try again in {n} second.',
		'Too many failed attempts. Try again in {n} seconds.',
		wait
	);
const secure = (ctx: FlowCtx) => ctx.url.protocol === 'https:';
const rp = (ctx: FlowCtx) => webauthn.relyingParty(ctx.url, ctx.config.PmaAbsoluteUri);
const formString = (fd: FormData, name: string) => {
	const v = fd.get(name);
	return typeof v === 'string' ? v : '';
};

function effective(ctx: FlowCtx, cfg: TwoFactorConfig) {
	return effectiveBackend(cfg.backend, availableBackends(ctx.config.DBG));
}

/** Render step (TwoFactorPlugin::render). `kind` is the cookie that keeps the WebAuthn challenge. */
export async function challenge(
	ctx: FlowCtx,
	cfg: TwoFactorConfig,
	kind: 'login' | 'confirm'
): Promise<ChallengeView> {
	const backend = effective(ctx, cfg);
	if (backend === 'WebAuthn') {
		const options = await webauthn.requestOptions(
			rp(ctx),
			webauthn.readWebAuthnSettings(cfg.settings)
		);
		setState(
			ctx.cookies,
			ctx.config.blowfish_secret,
			kind,
			ctx.user,
			ctx.serverIndex,
			{ challenge: options.challenge },
			secure(ctx)
		);
		return { backend, options };
	}
	if (backend === 'application' || backend === 'simple') return { backend };
	return { backend: 'invalid' };
}

/** Check step (TwoFactorPlugin::check) with the per-user failure limit. */
export async function check(
	ctx: FlowCtx,
	cfg: TwoFactorConfig,
	fd: FormData,
	kind: 'login' | 'confirm'
): Promise<CheckResult> {
	const lk = limiterKey(ctx.serverIndex, ctx.user);
	const wait = secondFactorLimiter.retryAfter(lk);
	if (wait > 0) {
		return { ok: false, error: tooMany(ctx, wait) };
	}
	const backend = effective(ctx, cfg);
	let ok = false;
	let message = '';
	try {
		if (backend === 'application') {
			const secret = typeof cfg.settings.secret === 'string' ? cfg.settings.secret : '';
			ok = secret !== '' && verifyTotp(secret, formString(fd, '2fa_code'));
		} else if (backend === 'simple') {
			ok = fd.has('2fa_confirm');
		} else if (backend === 'WebAuthn') {
			const state = getState(
				ctx.cookies,
				ctx.config.blowfish_secret,
				kind,
				ctx.user,
				ctx.serverIndex
			);
			clearState(ctx.cookies, kind); // a challenge is single use
			const raw = formString(fd, 'webauthn_request_response');
			if (state && typeof state.challenge === 'string' && raw !== '') {
				const response = JSON.parse(raw);
				const settings = webauthn.readWebAuthnSettings(cfg.settings);
				const updated = await webauthn.verifyRequest(rp(ctx), response, state.challenge, settings);
				ok = true;
				// keep the signature counter current (best effort, like phpMyAdmin never does)
				await saveTwoFactor(ctx.server, ctx.own, ctx.user, {
					backend: cfg.backend,
					settings: { ...cfg.settings, ...updated }
				}).catch(() => {});
			}
		}
	} catch (e) {
		ok = false;
		if (backend === 'WebAuthn' && e instanceof Error) message = e.message;
	}
	if (ok) {
		secondFactorLimiter.reset(lk);
		return { ok: true };
	}
	secondFactorLimiter.fail(lk);
	return { ok: false, error: failedText(ctx, message) };
}

/** Setup step (TwoFactorPlugin::setup): what the configure form shows. */
export async function setup(
	ctx: FlowCtx,
	backend: string,
	current: TwoFactorConfig
): Promise<SetupView | null> {
	const secret = ctx.config.blowfish_secret;
	if (backend === 'application') {
		// the new secret survives the confirmation round trip (`2fa_application_key` in phpMyAdmin)
		const state = getState(ctx.cookies, secret, 'setup', ctx.user, ctx.serverIndex);
		let key = state?.backend === 'application' ? String(state.secret ?? '') : '';
		if (!key) {
			key = generateSecret();
			setState(
				ctx.cookies,
				secret,
				'setup',
				ctx.user,
				ctx.serverIndex,
				{ backend, secret: key },
				secure(ctx)
			);
		}
		const issuer = `svelteMyAdmin (${rp(ctx).id})`;
		const qrSvg = await QRCode.toString(otpauthUri(key, issuer, ctx.user), {
			type: 'svg',
			margin: 1
		});
		return { backend, secret: key, qrSvg };
	}
	if (backend === 'WebAuthn') {
		const settings = webauthn.readWebAuthnSettings(
			current.backend === 'WebAuthn' ? current.settings : {}
		);
		const handle = settings.userHandle || webauthn.newUserHandle();
		const options = await webauthn.creationOptions(rp(ctx), ctx.user, handle, settings);
		setState(
			ctx.cookies,
			secret,
			'setup',
			ctx.user,
			ctx.serverIndex,
			{ backend, challenge: options.challenge, userHandle: handle },
			secure(ctx)
		);
		return { backend, options };
	}
	if (backend === 'simple') return { backend };
	return null;
}

export type ConfigureResult = { ok: true; config: TwoFactorConfig } | { ok: false; error: string };

/** Configure step (TwoFactorPlugin::configure): validate the proof and build the config to save. */
export async function configure(
	ctx: FlowCtx,
	backend: string,
	fd: FormData
): Promise<ConfigureResult> {
	const lk = limiterKey(ctx.serverIndex, ctx.user);
	const wait = secondFactorLimiter.retryAfter(lk);
	if (wait > 0) return { ok: false, error: tooMany(ctx, wait) };
	const secret = ctx.config.blowfish_secret;
	const state = getState(ctx.cookies, secret, 'setup', ctx.user, ctx.serverIndex);
	let result: ConfigureResult = { ok: false, error: failedText(ctx) };
	if (backend === 'application') {
		const key = state?.backend === 'application' ? String(state.secret ?? '') : '';
		if (key && verifyTotp(key, formString(fd, '2fa_code'))) {
			result = { ok: true, config: { backend, settings: { secret: key } } };
		}
	} else if (backend === 'WebAuthn') {
		clearState(ctx.cookies, 'setup');
		const raw = formString(fd, 'webauthn_creation_response');
		if (state?.backend === 'WebAuthn' && raw !== '') {
			try {
				const cred = await webauthn.verifyCreation(
					rp(ctx),
					JSON.parse(raw),
					String(state.challenge),
					String(state.userHandle)
				);
				const existing = await currentWebAuthn(ctx);
				result = {
					ok: true,
					config: { backend, settings: { ...webauthn.addCredential(existing, cred) } }
				};
			} catch (e) {
				result = {
					ok: false,
					error: failedText(ctx, e instanceof Error ? e.message : '')
				};
			}
		}
	} else if (backend === 'simple') {
		if (fd.has('2fa_confirm')) result = { ok: true, config: { backend, settings: {} } };
	}
	if (result.ok) {
		secondFactorLimiter.reset(lk);
		clearState(ctx.cookies, 'setup');
	} else {
		secondFactorLimiter.fail(lk);
	}
	return result;
}

async function currentWebAuthn(ctx: FlowCtx): Promise<webauthn.WebAuthnSettings> {
	const cur = await loadTwoFactor(ctx.server, ctx.own, ctx.user);
	return webauthn.readWebAuthnSettings(
		cur?.config.backend === 'WebAuthn' ? cur.config.settings : {}
	);
}
