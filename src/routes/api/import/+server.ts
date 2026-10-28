import { error } from '@sveltejs/kit';
import type { ImportEvent } from '#lib/import/types.ts';
import { runImport } from '#lib/server/import/execute.ts';
import { memoryLimitBytes, timeBudgetMs } from '#lib/server/import/limits.ts';
import { streamChunks } from '#lib/server/import/source.ts';
import { parseFileName, parseRequestOptions, parseScope } from '#lib/server/import/request.ts';
import type { RequestHandler } from './$types';

/**
 * Import endpoint. The request body is the raw file (octet-stream; never buffered), the import
 * settings travel in headers (`x-import-name`, `x-import-options`, both URI-encoded) and the scope
 * in the query string (`?db=&table=`). The response is NDJSON: `progress` lines while the file is
 * processed and a final `done` line with the result. The connection stays open until the end.
 */
export const POST: RequestHandler = async ({ request, locals, url }) => {
	const scope = parseScope(url.searchParams);
	const fileName = parseFileName(request.headers.get('x-import-name'));
	const options = parseRequestOptions(request.headers.get('x-import-options'));
	if (!scope || !fileName || !options || !request.body) error(400, 'Invalid request');

	const conn = await locals.db;
	const config = locals.config;
	const encoder = new TextEncoder();
	const body = request.body;

	const stream = new ReadableStream<Uint8Array>({
		async start(controller) {
			const send = (e: ImportEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + '\n'));
			try {
				const result = await runImport({
					conn,
					scope,
					body: streamChunks(body),
					fileName,
					request: options,
					timeBudgetMs: timeBudgetMs(config.ExecTimeLimit),
					memoryLimit: memoryLimitBytes(config.MemoryLimit),
					onProgress: (p) => send({ t: 'progress', ...p })
				});
				send({ t: 'done', result });
			} catch (e) {
				console.error('Import request failed', e);
				send({ t: 'error', message: 'The import failed unexpectedly.' });
			} finally {
				controller.close();
			}
		}
	});
	return new Response(stream, {
		headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' }
	});
};
