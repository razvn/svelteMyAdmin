import { handleTemplatePost } from '#lib/server/export/endpoint.ts';
import type { RequestHandler } from './$types';

/** Export templates CRUD (`pma__export_templates`). */
export const POST: RequestHandler = (event) => handleTemplatePost(event, 'server');
