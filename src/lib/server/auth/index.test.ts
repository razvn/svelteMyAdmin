import { describe, expect, it } from 'vitest';
import { configSchema } from '../config/schema';
import { sessionInfo } from './index';

const server = (auth_type: 'cookie' | 'signon') =>
	configSchema.parse({
		Servers: [
			{
				host: 'db',
				auth_type,
				user: 'shared',
				...(auth_type === 'signon'
					? { Signon: { identity: { type: 'trusted-header', trustedProxies: ['10.0.0.1'] } } }
					: {})
			}
		]
	}).Servers[0];

describe('sessionInfo storageUser', () => {
	it('is the SSO identity for signon, while user stays the shared MySQL account', () => {
		const info = sessionInfo(server('signon'), {
			serverIndex: 1,
			user: 'shared',
			password: 'pw',
			identity: { user: 'alice', groups: [] }
		});
		expect(info).toMatchObject({ user: 'shared', identity: 'alice', storageUser: 'alice' });
	});

	it('is the MySQL user when there is no identity', () => {
		const info = sessionInfo(server('cookie'), { serverIndex: 1, user: 'bob', password: 'pw' });
		expect(info.storageUser).toBe('bob');
		expect(info.identity).toBeUndefined();
	});
});
