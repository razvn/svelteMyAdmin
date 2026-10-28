import { deserialize } from '$app/forms';

/**
 * POST fields to a named form action of the current page (`?/name`) and return the deserialized
 * result, for dialogs that need the action's data without navigating.
 */
export async function callAction<T extends Record<string, unknown> = Record<string, unknown>>(
	pathname: string,
	name: string,
	fields: Record<string, string>
): Promise<{ ok: boolean; data: T | undefined; message: string | null }> {
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	let result: ReturnType<typeof deserialize>;
	try {
		const res = await fetch(`${pathname}?/${name}`, {
			method: 'POST',
			body,
			headers: { accept: 'application/json', 'x-sveltekit-action': 'true' }
		});
		result = deserialize(await res.text());
	} catch {
		return { ok: false, data: undefined, message: 'The request failed.' };
	}
	if (result.type === 'success') {
		return { ok: true, data: result.data as T | undefined, message: null };
	}
	if (result.type === 'failure') {
		const data = result.data as (T & { error?: string }) | undefined;
		return { ok: false, data, message: typeof data?.error === 'string' ? data.error : 'Failed.' };
	}
	return { ok: false, data: undefined, message: 'The request failed.' };
}
