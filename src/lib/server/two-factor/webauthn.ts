/**
 * WebAuthn/FIDO2 backend (`WebAuthn` in phpMyAdmin) on @simplewebauthn/server.
 *
 * Stored in `2fa.settings`, phpMyAdmin's layout (webauthn-framework PublicKeyCredentialSource JSON):
 * `userHandle` (base64url) and `credentials[<standard base64 id>] = { publicKeyCredentialId (base64url),
 * type, transports, attestationType, trustPath, aaguid, credentialPublicKey (base64url COSE key),
 * userHandle, counter, otherUI }`.
 */
import { randomBytes } from 'node:crypto';
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse
} from '@simplewebauthn/server';
import type {
	AuthenticationResponseJSON,
	AuthenticatorTransport,
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON,
	RegistrationResponseJSON
} from '@simplewebauthn/server';

export interface RelyingParty {
	id: string;
	origin: string;
	name: string;
}

export interface StoredCredential {
	publicKeyCredentialId: string;
	type: string;
	transports: string[];
	attestationType: string;
	trustPath: Record<string, unknown>;
	aaguid: string;
	credentialPublicKey: string;
	userHandle: string;
	counter: number;
	otherUI: unknown;
}

export interface WebAuthnSettings {
	userHandle: string;
	credentials: Record<string, StoredCredential>;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Relying party for a request: PmaAbsoluteUri when set (like phpMyAdmin's getAppId), else the URL. */
export function relyingParty(url: URL, pmaAbsoluteUri: string): RelyingParty {
	let base = url;
	if (pmaAbsoluteUri) {
		try {
			base = new URL(pmaAbsoluteUri);
		} catch {
			// keep the request URL
		}
	}
	return { id: base.hostname, origin: base.origin, name: `svelteMyAdmin (${base.hostname})` };
}

const b64urlToStd = (s: string) => Buffer.from(s, 'base64url').toString('base64');

/** TwoFactor WebAuthn constructor defaults: only well-formed credentials survive. */
export function readWebAuthnSettings(settings: Record<string, unknown>): WebAuthnSettings {
	const credentials: Record<string, StoredCredential> = {};
	if (isObject(settings.credentials)) {
		for (const [k, c] of Object.entries(settings.credentials)) {
			if (
				isObject(c) &&
				typeof c.publicKeyCredentialId === 'string' &&
				c.publicKeyCredentialId !== '' &&
				typeof c.credentialPublicKey === 'string'
			) {
				credentials[k] = { ...(c as unknown as StoredCredential), counter: Number(c.counter) || 0 };
			}
		}
	}
	return {
		userHandle: typeof settings.userHandle === 'string' ? settings.userHandle : '',
		credentials
	};
}

export function newUserHandle(): string {
	return randomBytes(32).toString('base64url');
}

export async function creationOptions(
	rp: RelyingParty,
	userName: string,
	userHandle: string,
	existing: WebAuthnSettings
): Promise<PublicKeyCredentialCreationOptionsJSON> {
	return generateRegistrationOptions({
		rpName: rp.name,
		rpID: rp.id,
		userName,
		userDisplayName: userName,
		userID: Buffer.from(userHandle, 'base64url'),
		attestationType: 'none',
		timeout: 60000,
		authenticatorSelection: {
			authenticatorAttachment: 'cross-platform',
			userVerification: 'discouraged',
			residentKey: 'discouraged'
		},
		excludeCredentials: Object.values(existing.credentials).map((c) => ({
			id: c.publicKeyCredentialId
		}))
	});
}

/** Verify an attestation; returns the credential record to store, or throws. */
export async function verifyCreation(
	rp: RelyingParty,
	response: RegistrationResponseJSON,
	expectedChallenge: string,
	userHandle: string
): Promise<StoredCredential> {
	const v = await verifyRegistrationResponse({
		response,
		expectedChallenge,
		expectedOrigin: rp.origin,
		expectedRPID: rp.id,
		requireUserVerification: false
	});
	if (!v.verified) throw new Error('The registration could not be verified.');
	const { credential, aaguid } = v.registrationInfo;
	return {
		publicKeyCredentialId: credential.id,
		type: 'public-key',
		transports: credential.transports ?? [],
		attestationType: 'none',
		trustPath: { type: 'Webauthn\\TrustPath\\EmptyTrustPath' },
		aaguid,
		credentialPublicKey: Buffer.from(credential.publicKey).toString('base64url'),
		userHandle,
		counter: credential.counter,
		otherUI: null
	};
}

export async function requestOptions(
	rp: RelyingParty,
	settings: WebAuthnSettings
): Promise<PublicKeyCredentialRequestOptionsJSON> {
	return generateAuthenticationOptions({
		rpID: rp.id,
		timeout: 60000,
		userVerification: 'discouraged',
		allowCredentials: Object.values(settings.credentials).map((c) => ({
			id: c.publicKeyCredentialId,
			transports: c.transports as AuthenticatorTransport[]
		}))
	});
}

/**
 * Verify an assertion against the stored credentials. Returns the settings with the credential's
 * counter updated, or throws.
 */
export async function verifyRequest(
	rp: RelyingParty,
	response: AuthenticationResponseJSON,
	expectedChallenge: string,
	settings: WebAuthnSettings
): Promise<WebAuthnSettings> {
	const entry = Object.entries(settings.credentials).find(
		([, c]) => c.publicKeyCredentialId === response.id
	);
	if (!entry) throw new Error('Unknown credential.');
	const [key, stored] = entry;
	const v = await verifyAuthenticationResponse({
		response,
		expectedChallenge,
		expectedOrigin: rp.origin,
		expectedRPID: rp.id,
		requireUserVerification: false,
		credential: {
			id: stored.publicKeyCredentialId,
			publicKey: Buffer.from(stored.credentialPublicKey, 'base64url'),
			counter: stored.counter,
			transports: stored.transports as AuthenticatorTransport[]
		}
	});
	if (!v.verified) throw new Error('The assertion could not be verified.');
	return {
		...settings,
		credentials: {
			...settings.credentials,
			[key]: { ...stored, counter: v.authenticationInfo.newCounter }
		}
	};
}

/** Add a credential under phpMyAdmin's key (standard base64 of the id) and remember the user handle. */
export function addCredential(settings: WebAuthnSettings, c: StoredCredential): WebAuthnSettings {
	return {
		userHandle: c.userHandle,
		credentials: { ...settings.credentials, [b64urlToStd(c.publicKeyCredentialId)]: c }
	};
}
