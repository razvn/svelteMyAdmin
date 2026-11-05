/**
 * `Signon.authorize: { type: "kubernetes-sar" }`: Kubernetes RBAC of a namespace decides whether the
 * person the SSO proxy authenticated may use the server. See docs/SIGNON.md, "Kubernetes RBAC".
 */
import { z } from 'zod';
import { apiServerOf, inClusterApiServer, kubernetesRequest } from '../../kubernetes/client.ts';
import type { KubernetesSarConfig } from '../../config/schema';
import type { Identity } from '../plugins/types';

export type AuthorizeDecision = { allowed: true } | { allowed: false; reason: string };

export interface SubjectAccessReview {
	apiVersion: 'authorization.k8s.io/v1';
	kind: 'SubjectAccessReview';
	spec: {
		user: string;
		groups: string[];
		resourceAttributes: {
			namespace: string;
			verb: string;
			group: string;
			resource: string;
			subresource?: string;
		};
	};
}

const SAR_PATH = '/apis/authorization.k8s.io/v1/subjectaccessreviews';
const MAX_CACHE_ENTRIES = 1000;

/** The review asking whether `identity`, named as the cluster's OIDC config names it, may access the resource. */
export function sarRequest(identity: Identity, cfg: KubernetesSarConfig): SubjectAccessReview {
	const { group, resource, verb, subresource } = cfg.resource;
	return {
		apiVersion: 'authorization.k8s.io/v1',
		kind: 'SubjectAccessReview',
		spec: {
			user: cfg.userPrefix + identity.user,
			groups: [...identity.groups.map((g) => cfg.groupsPrefix + g), 'system:authenticated'],
			resourceAttributes: {
				namespace: cfg.namespace,
				verb,
				group,
				resource,
				...(subresource ? { subresource } : {})
			}
		}
	};
}

export { inClusterApiServer };

const sarResponse = z.object({
	status: z.object({
		allowed: z.boolean(),
		denied: z.boolean().optional(),
		reason: z.string().optional()
	})
});

/** POST the review (token and CA read on every call, see `kubernetesRequest`). */
async function postReview(
	review: SubjectAccessReview,
	cfg: KubernetesSarConfig,
	timeoutMs: number
): Promise<AuthorizeDecision> {
	const json = await kubernetesRequest(
		cfg,
		'SubjectAccessReview',
		'POST',
		SAR_PATH,
		review,
		timeoutMs
	);
	const parsed = sarResponse.safeParse(json);
	if (!parsed.success) throw new Error('SubjectAccessReview response has no status.allowed');
	const { allowed, reason } = parsed.data.status;
	return allowed ? { allowed: true } : { allowed: false, reason: reason ?? '' };
}

export interface AuthorizerOptions {
	timeoutMs?: number;
	/** Clock of the cache, in milliseconds. */
	now?: () => number;
}

/**
 * An authoriser with its own cache. Answers (allowed and denied) are reused for `cacheSeconds`;
 * errors are never cached; identical concurrent lookups share one request.
 */
export function createAuthorizer({ timeoutMs = 5000, now = Date.now }: AuthorizerOptions = {}) {
	const cache = new Map<string, { decision: Promise<AuthorizeDecision>; expiresAt: number }>();

	return function authorizeIdentity(
		identity: Identity,
		cfg: KubernetesSarConfig
	): Promise<AuthorizeDecision> {
		const apiServer = apiServerOf(cfg);
		const review = sarRequest(identity, cfg);
		const { user, groups, resourceAttributes } = review.spec;
		const key = JSON.stringify([apiServer, resourceAttributes, user, [...groups].sort()]);

		const hit = cache.get(key);
		if (hit && now() < hit.expiresAt) return hit.decision;

		const decision = postReview(review, cfg, timeoutMs);
		const entry = { decision, expiresAt: Infinity };
		cache.delete(key);
		cache.set(key, entry);
		if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
		decision.then(
			() => {
				if (cfg.cacheSeconds > 0) entry.expiresAt = now() + cfg.cacheSeconds * 1000;
				else if (cache.get(key) === entry) cache.delete(key);
			},
			() => {
				if (cache.get(key) === entry) cache.delete(key);
			}
		);
		return decision;
	};
}

export const authorizeIdentity = createAuthorizer();
