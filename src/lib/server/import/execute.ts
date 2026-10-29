/**
 * Import orchestration (Controllers/Import/ImportController.php): detect compression and format,
 * stream the upload through the format driver on the user's connection, and describe the outcome.
 */
import type { Connection } from 'mysql2/promise';
import { N_, SOURCE_TRANSLATOR, type Translator } from '#lib/i18n/translator.ts';
import {
	FORMAT_LABELS,
	type ImportFormat,
	type ImportRequestOptions,
	type ImportResult,
	type ImportScope
} from '#lib/import/types.ts';
import { escapeId } from '#lib/server/db/escape.ts';
import { CsvFormatError } from './formats/csv.ts';
import { DRIVERS } from './drivers.ts';
import { ImportRun } from './run.ts';
import { ImportAbort, prepareSource } from './source.ts';
import { DEFAULT_MEMORY_LIMIT } from './limits.ts';

export interface RunImportParams {
	conn: Connection;
	scope: ImportScope;
	body: AsyncIterable<Uint8Array>;
	fileName: string;
	request: ImportRequestOptions;
	/** Time budget in ms for interruptible imports (0 = none). */
	timeBudgetMs?: number;
	memoryLimit?: number;
	onProgress?: (p: { bytes: number; queries: number; ms: number }) => void;
	/** Translator for the messages shown to the user (default: English). */
	i18n?: Translator;
}

const RESUMABLE: ImportFormat[] = ['sql', 'csv', 'ldi'];

export const successMessage = (
	queries: number,
	fileName: string,
	tr: Translator = SOURCE_TRANSLATOR
): string =>
	tr.t('Import has been successfully finished, {n} queries executed. ({file})', {
		n: queries,
		file: fileName
	});

async function* counting(src: AsyncIterable<Uint8Array>, add: (n: number) => void) {
	for await (const c of src) {
		add(c.length);
		yield c;
	}
}

export async function runImport(p: RunImportParams): Promise<ImportResult> {
	const { conn, scope, request } = p;
	const tr = p.i18n ?? SOURCE_TRANSLATOR;
	let bytesRead = 0;
	const initialDb = scope.level === 'server' ? null : scope.db;
	const run = new ImportRun(
		conn,
		{
			skip: request.skipQueries,
			timeBudgetMs: request.allowInterrupt ? (p.timeBudgetMs ?? 0) : 0,
			onProgress: () =>
				p.onProgress?.({ bytes: bytesRead, queries: run.queries, ms: run.elapsedMs })
		},
		initialDb
	);
	run.tr = tr;
	let format: ImportFormat = request.format === 'auto' ? 'sql' : request.format;
	let compression: ImportResult['compression'] = 'none';

	try {
		const src = await prepareSource(
			counting(p.body, (n) => (bytesRead += n)),
			p.fileName,
			request.format
		);
		compression = src.compression;
		if (!src.format) {
			throw new ImportAbort(
				N_('The file format could not be detected from its name. Choose a format and try again.')
			);
		}
		format = src.format;
		if (format === 'ldi' && scope.level !== 'table') {
			throw new ImportAbort(N_('CSV using LOAD DATA is only available for tables.'));
		}

		if (scope.level !== 'server') {
			await conn.query(`USE ${escapeId(scope.db)}`);
		}
		await conn.query(`SET foreign_key_checks = ${request.fkChecks ? 1 : 0}`);

		await DRIVERS[format]({
			run,
			scope,
			bytes: src.bytes,
			charset: request.charset,
			options: request.options,
			innerName: src.innerName,
			memoryLimit: p.memoryLimit ?? DEFAULT_MEMORY_LIMIT
		});
	} catch (e) {
		if (e instanceof ImportAbort) run.fail(tr.t(e.message, e.params));
		else if (e instanceof CsvFormatError) run.fail(tr.t(e.msgid, { line: e.line }), e.line);
		else if (e instanceof RangeError && /encoding|label/i.test(e.message)) {
			run.fail(tr.t('Unsupported character set: {charset}', { charset: request.charset }));
		} else {
			const err = e as { sqlMessage?: string; message?: string; errno?: number };
			if (err.sqlMessage) {
				run.error = {
					line: null,
					statement: '',
					errno: err.errno ?? null,
					message: err.sqlMessage
				};
			} else {
				console.error('Import failed', e);
				run.fail(tr.t('The import failed unexpectedly.'));
			}
		}
	}

	const resumable = RESUMABLE.includes(format);
	const finished = !run.error && !run.interrupted;
	let message: string;
	if (run.error) {
		message = run.error.message;
	} else if (run.interrupted) {
		message = tr.tn(
			'The import was interrupted after {n} query because it came close to the time limit. Resubmit the same file to continue from position {seen} (skip {seen} queries).',
			'The import was interrupted after {n} queries because it came close to the time limit. Resubmit the same file to continue from position {seen} (skip {seen} queries).',
			run.queries,
			{ seen: run.seen }
		);
	} else {
		message = successMessage(run.queries, p.fileName, tr);
	}

	return {
		ok: finished,
		finished,
		interrupted: run.interrupted,
		fileName: p.fileName,
		compression,
		format,
		queries: run.queries,
		skipped: run.skipped,
		bytesRead,
		durationMs: run.elapsedMs,
		message,
		error: run.error,
		resumeSkip: resumable && (run.interrupted || run.error) ? run.seen : null,
		retrySkip: resumable && run.error && run.seen > 0 ? run.seen - 1 : null,
		statements: run.statements,
		statementsTruncated: run.statementsTruncated,
		warnings: run.warnings,
		affectedRows: run.affectedRows,
		created: [...run.created].map(([db, tables]) => ({ db, tables: [...tables] })),
		structureChanged: run.structureChanged,
		currentDb: run.currentDb !== initialDb ? run.currentDb : null
	};
}

export { FORMAT_LABELS };
