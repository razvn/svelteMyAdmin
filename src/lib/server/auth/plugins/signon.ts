import type { AuthPlugin } from './types';

const MESSAGE = 'The "signon" authentication type is not supported yet.';

function unsupported(): Response {
	return new Response(MESSAGE, {
		status: 501,
		headers: { 'content-type': 'text/plain; charset=utf-8' }
	});
}

/** `signon` placeholder: clearly reports that it is not implemented. */
export const signonAuth: AuthPlugin = {
	type: 'signon',
	getCredentials: () => null,
	unauthenticated: unsupported,
	logout: unsupported
};
