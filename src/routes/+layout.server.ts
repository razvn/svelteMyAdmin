import { availableLanguages } from '#lib/i18n/catalog.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = ({ locals }) => ({
	locale: locals.locale,
	languages: availableLanguages()
});
