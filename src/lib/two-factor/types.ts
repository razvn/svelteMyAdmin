/** Client-safe views of the second-factor steps (never contain secrets of stored configs). */
import type {
	PublicKeyCredentialCreationOptionsJSON,
	PublicKeyCredentialRequestOptionsJSON
} from '@simplewebauthn/browser';

/** What the form for an existing second factor needs (never contains the secret). */
export type ChallengeView =
	| { backend: 'application' | 'simple' | 'invalid' }
	| { backend: 'WebAuthn'; options: PublicKeyCredentialRequestOptionsJSON };

export type SetupView =
	| { backend: 'application'; secret: string; qrSvg: string }
	| { backend: 'WebAuthn'; options: PublicKeyCredentialCreationOptionsJSON }
	| { backend: 'simple' };
