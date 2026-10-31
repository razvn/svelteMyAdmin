/** Hidden navigation items in `pma__navigationhiding` (Navigation.php hide/unhide/getHiddenItems). */
import type { HiddenItem, HiddenType } from '#lib/nav/hidden.ts';
import { withRepo } from '#lib/server/storage/index.ts';

export type { HiddenItem, HiddenType };

const username = (locals: App.Locals) => locals.session?.user ?? '';

export {
	deleteHiddenRow,
	insertHiddenRow,
	selectHiddenRows
} from '#lib/server/storage/mysql/navigation-hiding.ts';

/** Hidden items of `db`; undefined when the navigationhiding feature is unavailable. */
export function listHiddenItems(locals: App.Locals, db: string) {
	return withRepo(locals, 'navigationHiding', (repo) => repo.list(username(locals), db));
}

/** True when stored. */
export async function hideItem(locals: App.Locals, db: string, item: HiddenItem): Promise<boolean> {
	return !!(await withRepo(locals, 'navigationHiding', async (repo) => {
		await repo.hide(username(locals), db, item);
		return true;
	}));
}

export async function unhideItem(
	locals: App.Locals,
	db: string,
	item: HiddenItem
): Promise<boolean> {
	return !!(await withRepo(locals, 'navigationHiding', async (repo) => {
		await repo.unhide(username(locals), db, item);
		return true;
	}));
}
