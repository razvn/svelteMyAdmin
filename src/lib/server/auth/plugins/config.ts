import { redirectResponse, type AuthPlugin } from './types';

/** `config` auth: user/password come from the server definition, no login page. */
export const configAuth: AuthPlugin = {
	type: 'config',

	getCredentials(ctx) {
		return {
			serverIndex: ctx.serverIndex,
			user: ctx.server.user,
			password: ctx.server.password
		};
	},

	unauthenticated() {
		// Cannot happen: credentials are always present.
		return new Response('Forbidden', { status: 403 });
	},

	rejected(ctx) {
		const t = ctx.t ?? ((s: string) => s);
		return new Response(t('Cannot log in to the MySQL server with the configured credentials.'), {
			status: 503,
			headers: { 'content-type': 'text/plain; charset=utf-8' }
		});
	},

	logout(ctx) {
		return redirectResponse(ctx.server.LogoutURL || '/');
	}
};
