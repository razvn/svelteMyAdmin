import { loadExportPage } from '#lib/server/export/endpoint.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => loadExportPage(event, 'server');
