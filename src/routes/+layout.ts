import { loadCatalog } from '#lib/i18n/catalog.ts';
import type { LayoutLoad } from './$types';

/** Runs on the server and in the browser: the client only downloads the catalog of the active language. */
export const load: LayoutLoad = async ({ data }) => ({
	locale: data.locale,
	languages: data.languages,
	catalog: await loadCatalog(data.locale)
});
