import type { SubmitFunction } from '$app/forms';

export interface AlterHandlers {
	start: () => void;
	fail: (message: string) => void;
	/** Called after the page data was refreshed; `sql` are the statements that ran. */
	success: (sql: string[]) => void | Promise<void>;
}

/**
 * `use:enhance` callback for the ALTER TABLE form actions (`{ done: string[] }` on success,
 * `fail(400, { error })` otherwise).
 */
export function alterEnhance(
	h: AlterHandlers,
	t: (msgid: string) => string = (msgid) => msgid
): SubmitFunction {
	return () => {
		h.start();
		return async ({ result, update }) => {
			if (result.type === 'success') {
				const sql = Array.isArray(result.data?.done) ? (result.data.done as string[]) : [];
				await update({ reset: false });
				await h.success(sql);
			} else if (result.type === 'failure') {
				h.fail(String(result.data?.error ?? t('The statement failed.')));
			} else if (result.type === 'redirect') {
				await update();
			} else {
				h.fail(t('Unexpected error while running the statement.'));
			}
		};
	};
}
