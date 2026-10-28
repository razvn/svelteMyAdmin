/**
 * Browser side of an import: POST the raw file to `/api/import` with XMLHttpRequest (upload
 * progress) and read the NDJSON events (`progress`, `done`) from the response while it streams.
 */
import type { ImportEvent, ImportOptionValues, ImportResult, ImportScope } from './types.ts';

export interface ImportSubmission {
	format: string;
	charset: string;
	allow_interrupt: boolean;
	skip_queries: number;
	fk_checks: boolean;
	options: ImportOptionValues;
}

export interface ImportCallbacks {
	/** Bytes sent to the server so far. */
	onUpload?: (loaded: number, total: number) => void;
	/** The server is working through the file. */
	onProgress?: (p: { bytes: number; queries: number; ms: number }) => void;
}

export interface ImportHandle {
	result: Promise<ImportResult>;
	abort: () => void;
}

export function importUrl(scope: ImportScope): string {
	const q = new URLSearchParams();
	if (scope.level !== 'server') q.set('db', scope.db);
	if (scope.level === 'table') q.set('table', scope.table);
	const qs = q.toString();
	return `/api/import${qs ? `?${qs}` : ''}`;
}

/** Split an NDJSON buffer into complete events; returns the unparsed rest. */
export function parseEvents(buffer: string): { events: ImportEvent[]; rest: string } {
	const events: ImportEvent[] = [];
	let start = 0;
	for (;;) {
		const nl = buffer.indexOf('\n', start);
		if (nl === -1) break;
		const line = buffer.slice(start, nl).trim();
		start = nl + 1;
		if (line === '') continue;
		try {
			events.push(JSON.parse(line) as ImportEvent);
		} catch {
			/* ignore a garbled line */
		}
	}
	return { events, rest: buffer.slice(start) };
}

export function startImport(
	file: File,
	scope: ImportScope,
	submission: ImportSubmission,
	cb: ImportCallbacks = {}
): ImportHandle {
	const xhr = new XMLHttpRequest();
	const result = new Promise<ImportResult>((resolve, reject) => {
		let consumed = 0;
		let rest = '';
		let done: ImportResult | null = null;
		let failure: string | null = null;

		const consume = () => {
			const text = xhr.responseText;
			if (text.length === consumed) return;
			const chunk = rest + text.slice(consumed);
			consumed = text.length;
			const parsed = parseEvents(chunk);
			rest = parsed.rest;
			for (const e of parsed.events) {
				if (e.t === 'progress') cb.onProgress?.(e);
				else if (e.t === 'done') done = e.result;
				else if (e.t === 'error') failure = e.message;
			}
		};

		xhr.open('POST', importUrl(scope));
		xhr.setRequestHeader('content-type', 'application/octet-stream');
		xhr.setRequestHeader('x-import-name', encodeURIComponent(file.name));
		xhr.setRequestHeader('x-import-options', encodeURIComponent(JSON.stringify(submission)));
		xhr.upload.onprogress = (e) =>
			cb.onUpload?.(e.loaded, e.lengthComputable ? e.total : file.size);
		xhr.onprogress = consume;
		xhr.onerror = () =>
			reject(new Error('The upload failed. Check your connection and try again.'));
		xhr.onabort = () => reject(new Error('The import was cancelled.'));
		xhr.onload = () => {
			consume();
			if (xhr.status === 413) {
				reject(
					new Error(
						'The file is larger than the upload limit of the server. Raise BODY_SIZE_LIMIT (adapter-node) or import a smaller or compressed file.'
					)
				);
			} else if (xhr.status === 401 || xhr.status === 403) {
				reject(new Error('Your session has expired. Log in again.'));
			} else if (done) {
				resolve(done);
			} else if (failure) {
				reject(new Error(failure));
			} else {
				reject(new Error(`The import request failed (HTTP ${xhr.status}).`));
			}
		};
		xhr.send(file);
	});
	return { result, abort: () => xhr.abort() };
}
