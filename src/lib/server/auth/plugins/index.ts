import type { AuthPlugin, AuthType } from './types';
import { configAuth } from './config';
import { cookieAuth } from './cookie';
import { httpAuth } from './http';
import { signonAuth } from './signon';

const plugins: Record<AuthType, AuthPlugin> = {
	cookie: cookieAuth,
	config: configAuth,
	http: httpAuth,
	signon: signonAuth
};

export function getAuthPlugin(type: AuthType): AuthPlugin {
	return plugins[type];
}

export * from './types';
