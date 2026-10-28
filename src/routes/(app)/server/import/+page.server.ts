import { loadImportPage } from '#lib/server/import/page.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => loadImportPage(event, { level: 'server' });
