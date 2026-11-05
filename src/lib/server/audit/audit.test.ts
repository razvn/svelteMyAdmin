import { describe, expect, it } from 'vitest';
import { auditLogSchema } from '#lib/server/config/schema.ts';
import { requestAudit, type Actor } from './index.ts';

const actor: Actor = {
	identity: 'alice',
	mysqlUser: 'shared',
	email: 'alice@example.com',
	server: 'db.internal:3306',
	serverId: '1',
	clientIp: '203.0.113.7'
};

function capture(config = { target: 'stdout' }) {
	const lines: string[] = [];
	const audit = requestAudit(
		auditLogSchema.parse(config),
		actor,
		{ write: (l) => lines.push(l) },
		() => new Date('2026-11-04T10:00:00.000Z')
	);
	return { audit, lines };
}

describe('requestAudit', () => {
	it('writes one JSON object per event with the actor filled in', () => {
		const { audit, lines } = capture();
		audit.write({ event: 'session' });
		audit.write({
			event: 'statement',
			db: 'shop',
			sql: 'DELETE FROM t',
			ok: true,
			affectedRows: 3
		});
		expect(lines).toHaveLength(2);
		expect(lines.every((l) => !l.includes('\n'))).toBe(true);
		expect(JSON.parse(lines[0])).toEqual({
			ts: '2026-11-04T10:00:00.000Z',
			event: 'session',
			identity: 'alice',
			mysqlUser: 'shared',
			email: 'alice@example.com',
			server: 'db.internal:3306',
			serverId: '1',
			clientIp: '203.0.113.7'
		});
		expect(JSON.parse(lines[1])).toMatchObject({
			event: 'statement',
			identity: 'alice',
			db: 'shop',
			sql: 'DELETE FROM t',
			ok: true,
			affectedRows: 3
		});
	});

	it('lets an event override the actor (unverified user of a denied request)', () => {
		const { audit, lines } = capture();
		audit.write(
			{ event: 'denied', reason: 'access-denied', claimedUser: 'mallory' },
			{ identity: null, mysqlUser: null, serverId: '2', server: 'other' }
		);
		expect(JSON.parse(lines[0])).toMatchObject({
			event: 'denied',
			identity: null,
			mysqlUser: null,
			claimedUser: 'mallory',
			reason: 'access-denied',
			serverId: '2',
			server: 'other'
		});
	});

	it('cuts SQL longer than maxSqlLength and flags it', () => {
		const { audit, lines } = capture({ target: 'stdout', maxSqlLength: 10 } as never);
		audit.write({ event: 'statement', db: null, sql: 'INSERT INTO t VALUES (1)', ok: true });
		audit.write({ event: 'statement', db: null, sql: 'DROP TABLE', ok: true });
		expect(JSON.parse(lines[0])).toMatchObject({ sql: 'INSERT INT', truncated: true });
		expect(JSON.parse(lines[1]).truncated).toBeUndefined();
		expect(JSON.parse(lines[1]).sql).toBe('DROP TABLE');
	});
});
