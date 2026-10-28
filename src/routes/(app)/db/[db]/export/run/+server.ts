import { handleExportPost } from '#lib/server/export/endpoint.ts';
import type { RequestHandler } from './$types';

/** Runs the export: a file download, or the text (`output_format=astext`). */
export const POST: RequestHandler = (event) => handleExportPost(event, 'database');
