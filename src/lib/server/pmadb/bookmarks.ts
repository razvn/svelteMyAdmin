/** Bookmarks (libraries/classes/Bookmark.php). `user = ''` means shared. */
import { escapeString } from '#lib/server/db/escape.ts';
import { applyVariables } from '#lib/sql/bookmark.ts';
import { withRepo } from '#lib/server/storage/index.ts';
import type { Bookmark, NewBookmark } from '#lib/server/storage/types.ts';

export type { Bookmark, NewBookmark };
export {
	deleteBookmarkRow,
	getBookmarkRow,
	insertBookmarkRow,
	listBookmarkRows
} from '#lib/server/storage/mysql/bookmarks.ts';

const userOf = (locals: App.Locals) => locals.session?.user ?? '';

/** undefined = bookmark storage not available. */
export const listBookmarks = (locals: App.Locals, db: string) =>
	withRepo(locals, 'bookmarks', (r) => r.list(userOf(locals), db));

export const createBookmark = (locals: App.Locals, b: NewBookmark) =>
	withRepo(locals, 'bookmarks', (r) => r.insert(userOf(locals), b));

export const removeBookmark = (locals: App.Locals, id: number) =>
	withRepo(locals, 'bookmarks', (r) => r.delete(userOf(locals), id));

/** The bookmark's query with its `[VARIABLEn]` placeholders replaced; null when not found. */
export async function bookmarkQuery(
	locals: App.Locals,
	db: string,
	id: number,
	variables: string[]
): Promise<string | null | undefined> {
	return withRepo(locals, 'bookmarks', async (r) => {
		const b = await r.get(userOf(locals), db, id);
		return b ? applyVariables(b.query, variables, escapeString) : null;
	});
}
