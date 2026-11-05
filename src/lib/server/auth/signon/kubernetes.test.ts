import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { kubernetesSarSchema, type KubernetesSarConfig } from '#lib/server/config/schema.ts';
import { createAuthorizer, inClusterApiServer, sarRequest } from './kubernetes.ts';

const alice = { user: 'alice', email: 'alice@example.com', groups: ['dev', 'ops'] };

function sarConfig(extra: Record<string, unknown> = {}): KubernetesSarConfig {
	return kubernetesSarSchema.parse({ type: 'kubernetes-sar', namespace: 'review-123', ...extra });
}

describe('sarRequest', () => {
	it('asks whether the person may get pods in the namespace, as an authenticated user', () => {
		expect(sarRequest(alice, sarConfig())).toEqual({
			apiVersion: 'authorization.k8s.io/v1',
			kind: 'SubjectAccessReview',
			spec: {
				user: 'alice',
				groups: ['dev', 'ops', 'system:authenticated'],
				resourceAttributes: { namespace: 'review-123', verb: 'get', group: '', resource: 'pods' }
			}
		});
	});

	it('names the person and groups like the cluster OIDC config, and sends the subresource', () => {
		const review = sarRequest(
			alice,
			sarConfig({
				userPrefix: 'oidc:',
				groupsPrefix: 'gitlab:',
				resource: { resource: 'services', verb: 'create', subresource: 'proxy' }
			})
		);
		expect(review.spec.user).toBe('oidc:alice');
		expect(review.spec.groups).toEqual(['gitlab:dev', 'gitlab:ops', 'system:authenticated']);
		expect(review.spec.resourceAttributes).toEqual({
			namespace: 'review-123',
			verb: 'create',
			group: '',
			resource: 'services',
			subresource: 'proxy'
		});
	});
});

describe('inClusterApiServer', () => {
	it('uses the service variables Kubernetes sets in the pod', () => {
		expect(
			inClusterApiServer({ KUBERNETES_SERVICE_HOST: '10.96.0.1', KUBERNETES_SERVICE_PORT: '443' })
		).toBe('https://10.96.0.1:443');
	});

	it('brackets an IPv6 host', () => {
		expect(
			inClusterApiServer({ KUBERNETES_SERVICE_HOST: 'fd00::1', KUBERNETES_SERVICE_PORT: '443' })
		).toBe('https://[fd00::1]:443');
	});

	it('fails outside a cluster', () => {
		expect(() => inClusterApiServer({})).toThrow(/KUBERNETES_SERVICE_HOST/);
	});
});

interface Received {
	method: string;
	url: string;
	authorization: string | undefined;
	body: unknown;
}

/** Fake Kubernetes API server: records the reviews and answers with `reply`. */
let reply: (req: Received, res: ServerResponse) => void;
let received: Received[];
let api: Server;
let apiServer: string;
let dir: string;
let tokenFile: string;

beforeAll(async () => {
	api = createServer((req: IncomingMessage, res) => {
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => {
			const r: Received = {
				method: req.method ?? '',
				url: req.url ?? '',
				authorization: req.headers.authorization,
				body: JSON.parse(Buffer.concat(chunks).toString('utf8'))
			};
			received.push(r);
			reply(r, res);
		});
	});
	await new Promise<void>((resolve) => api.listen(0, '127.0.0.1', resolve));
	apiServer = `http://127.0.0.1:${(api.address() as AddressInfo).port}`;
	dir = await mkdtemp(join(tmpdir(), 'sma-sar-'));
	tokenFile = join(dir, 'token');
});

afterAll(async () => {
	api.closeAllConnections();
	await new Promise((resolve) => api.close(resolve));
	await rm(dir, { recursive: true, force: true });
});

afterEach(() => {
	received = [];
});

function answer(allowed: boolean, reason?: string) {
	return (_req: Received, res: ServerResponse) => {
		res.writeHead(201, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ kind: 'SubjectAccessReview', status: { allowed, reason } }));
	};
}

async function setup(extra: Record<string, unknown> = {}, timeoutMs = 2000) {
	received = [];
	await writeFile(tokenFile, 'token-1\n');
	let clock = 0;
	const authorize = createAuthorizer({ timeoutMs, now: () => clock });
	const cfg = sarConfig({ apiServer, tokenFile, ...extra });
	return {
		authorize: () => authorize(alice, cfg),
		advance: (ms: number) => (clock += ms)
	};
}

describe('createAuthorizer against an API server', () => {
	it('posts the review with the ServiceAccount token and returns the answer', async () => {
		reply = answer(true);
		const { authorize } = await setup();
		await expect(authorize()).resolves.toEqual({ allowed: true });
		expect(received).toEqual([
			{
				method: 'POST',
				url: '/apis/authorization.k8s.io/v1/subjectaccessreviews',
				authorization: 'Bearer token-1',
				body: sarRequest(alice, sarConfig())
			}
		]);
	});

	it('returns a denial with the API server reason', async () => {
		reply = answer(false, 'no RBAC policy matched');
		const { authorize } = await setup();
		await expect(authorize()).resolves.toEqual({
			allowed: false,
			reason: 'no RBAC policy matched'
		});
	});

	it('reuses an answer for cacheSeconds, then asks again', async () => {
		reply = answer(false);
		const { authorize, advance } = await setup({ cacheSeconds: 60 });
		await authorize();
		advance(59_000);
		await authorize();
		expect(received).toHaveLength(1);
		advance(1_000);
		await authorize();
		expect(received).toHaveLength(2);
	});

	it('asks every time with cacheSeconds 0', async () => {
		reply = answer(true);
		const { authorize } = await setup({ cacheSeconds: 0 });
		await authorize();
		await authorize();
		expect(received).toHaveLength(2);
	});

	it('shares one request between concurrent identical lookups', async () => {
		reply = answer(true);
		const { authorize } = await setup({ cacheSeconds: 0 });
		const results = await Promise.all([authorize(), authorize(), authorize()]);
		expect(results).toEqual([{ allowed: true }, { allowed: true }, { allowed: true }]);
		expect(received).toHaveLength(1);
	});

	it('sends the rotated token on the next lookup', async () => {
		reply = answer(true);
		const { authorize } = await setup({ cacheSeconds: 0 });
		await authorize();
		await writeFile(tokenFile, 'token-2\n');
		await authorize();
		expect(received.map((r) => r.authorization)).toEqual(['Bearer token-1', 'Bearer token-2']);
	});

	it.each([
		[
			'an HTTP error',
			(_req: Received, res: ServerResponse) => {
				res.writeHead(500);
				res.end('boom');
			},
			/HTTP 500/
		],
		[
			'a body that is not JSON',
			(_req: Received, res: ServerResponse) => {
				res.writeHead(201);
				res.end('<html>');
			},
			/not JSON/
		],
		[
			'a body without status.allowed',
			(_req: Received, res: ServerResponse) => {
				res.writeHead(201);
				res.end('{"status":{}}');
			},
			/status\.allowed/
		]
	])('throws on %s and does not cache it', async (_name, failing, error) => {
		reply = failing;
		const { authorize } = await setup();
		await expect(authorize()).rejects.toThrow(error);
		reply = answer(true);
		await expect(authorize()).resolves.toEqual({ allowed: true });
		expect(received).toHaveLength(2);
	});

	it('throws when the API server does not answer in time', async () => {
		reply = () => {};
		const { authorize } = await setup({}, 100);
		await expect(authorize()).rejects.toThrow(/timed out/);
		reply = answer(true);
		await expect(authorize()).resolves.toEqual({ allowed: true });
	});

	it('throws when the token file is missing', async () => {
		reply = answer(true);
		const { authorize } = await setup({ tokenFile: join(dir, 'missing') });
		await expect(authorize()).rejects.toThrow(/ENOENT/);
		expect(received).toHaveLength(0);
	});
});
