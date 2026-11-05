/**
 * Minimal Kubernetes API client: one JSON request authenticated with the pod's ServiceAccount.
 * Shared by the RBAC check (`Signon.authorize`) and server discovery (`ServerDiscovery`).
 */
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

/** Where the API server is and how the app authenticates to it. */
export interface KubernetesAccess {
	/** Default: in-cluster, `https://$KUBERNETES_SERVICE_HOST:$KUBERNETES_SERVICE_PORT`. */
	apiServer?: string;
	tokenFile: string;
	caFile: string;
}

const MAX_RESPONSE_BYTES = 8 << 20;

/** In-cluster API server address, from the variables Kubernetes sets in every pod. */
export function inClusterApiServer(env: NodeJS.ProcessEnv = process.env): string {
	const host = env.KUBERNETES_SERVICE_HOST;
	const port = env.KUBERNETES_SERVICE_PORT;
	if (!host || !port) {
		throw new Error(
			'apiServer is not set and KUBERNETES_SERVICE_HOST/PORT are missing (not running in a cluster?)'
		);
	}
	return `https://${host.includes(':') ? `[${host}]` : host}:${port}`;
}

export const apiServerOf = (access: KubernetesAccess): string =>
	(access.apiServer ?? inClusterApiServer()).replace(/\/+$/, '');

/**
 * Send one request and return the parsed JSON body. Token and CA are read on every call: projected
 * ServiceAccount tokens rotate. `what` names the request in errors (never the token or the body sent).
 */
export async function kubernetesRequest(
	access: KubernetesAccess,
	what: string,
	method: 'GET' | 'POST',
	path: string,
	body: unknown,
	timeoutMs: number
): Promise<unknown> {
	const url = new URL(apiServerOf(access) + path);
	const https = url.protocol === 'https:';
	const token = (await readFile(access.tokenFile, 'utf8')).trim();
	const ca = https ? await readFile(access.caFile) : undefined;
	const payload = body === undefined ? undefined : JSON.stringify(body);

	const { status, text } = await new Promise<{ status: number; text: string }>(
		(resolve, reject) => {
			const req = (https ? httpsRequest : httpRequest)(
				url,
				{
					method,
					headers: {
						authorization: `Bearer ${token}`,
						accept: 'application/json',
						...(payload === undefined
							? {}
							: {
									'content-type': 'application/json',
									'content-length': Buffer.byteLength(payload)
								})
					},
					...(ca ? { ca } : {})
				},
				(res) => {
					const chunks: Buffer[] = [];
					let size = 0;
					res.on('data', (chunk: Buffer) => {
						size += chunk.length;
						if (size > MAX_RESPONSE_BYTES) {
							req.destroy(new Error(`${what} response too large`));
						} else {
							chunks.push(chunk);
						}
					});
					res.on('end', () =>
						resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8') })
					);
					res.on('error', reject);
				}
			);
			req.setTimeout(timeoutMs, () =>
				req.destroy(new Error(`${what} timed out after ${timeoutMs} ms`))
			);
			req.on('error', reject);
			req.end(payload);
		}
	);

	if (status < 200 || status >= 300) {
		// Kubernetes error bodies are Status objects (reason, message): no secret data.
		throw new Error(`${what} failed: HTTP ${status} ${text.slice(0, 200)}`);
	}
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`${what} response is not JSON`);
	}
}
