import { withRepo } from '#lib/server/storage/index.ts';
import type { TrackingCtx } from './tracking.ts';

export type TrackingResult<T> = { ok: true; value: T } | { ok: false; error: string };

const UNAVAILABLE = 'The configuration storage is not ready for the tracking feature.';

/**
 * Run `fn` with the tracking storage. SQL errors inside `fn` come back as `{ ok: false }` with the
 * server message; an unconfigured / unreachable storage as a generic "not ready" error.
 */
export async function withTracking<T>(
	locals: App.Locals,
	fn: (ctx: TrackingCtx) => Promise<T>
): Promise<TrackingResult<T>> {
	const res = await withRepo(locals, 'tracking', async (repo): Promise<TrackingResult<T>> => {
		try {
			return {
				ok: true,
				value: await fn({ repo, user: locals.session?.user ?? '', server: locals.server })
			};
		} catch (e) {
			return { ok: false, error: (e as { sqlMessage?: string }).sqlMessage ?? String(e) };
		}
	});
	return res ?? { ok: false, error: UNAVAILABLE };
}
