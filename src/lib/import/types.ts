/** Shapes shared by the import server code, the NDJSON progress stream and the import page. */

export type ImportScope =
	{ level: 'server' } | { level: 'db'; db: string } | { level: 'table'; db: string; table: string };

export type ImportFormat = 'sql' | 'csv' | 'ldi' | 'ods' | 'xml' | 'mediawiki';

export const IMPORT_FORMATS: ImportFormat[] = ['sql', 'csv', 'ldi', 'ods', 'xml', 'mediawiki'];

export const FORMAT_LABELS: Record<ImportFormat, string> = {
	sql: 'SQL',
	csv: 'CSV',
	ldi: 'CSV using LOAD DATA',
	ods: 'OpenDocument Spreadsheet',
	xml: 'XML',
	mediawiki: 'MediaWiki Table'
};

/** File extension (without compression suffix) => format, for "format by extension". */
export const FORMAT_EXTENSIONS: Record<string, ImportFormat> = {
	sql: 'sql',
	csv: 'csv',
	tsv: 'csv',
	ldi: 'ldi',
	ods: 'ods',
	xml: 'xml',
	txt: 'mediawiki',
	wiki: 'mediawiki',
	mediawiki: 'mediawiki'
};

export type Compression = 'none' | 'gzip' | 'zip' | 'bzip2';

export interface ImportStatementInfo {
	/** 1-based line of the statement / row in the file, when known. */
	line: number | null;
	/** First characters of the statement. */
	sql: string;
	affectedRows: number;
	/** Rows of a SELECT/SHOW result (not kept). */
	rows: number | null;
	warnings: number;
}

export interface ImportErrorInfo {
	line: number | null;
	/** Excerpt of the failing statement ('' for format errors). */
	statement: string;
	errno: number | null;
	message: string;
}

export interface ImportWarningInfo {
	level: string;
	code: number;
	message: string;
	line: number | null;
}

export interface ImportResult {
	ok: boolean;
	/** The whole file was consumed. */
	finished: boolean;
	/** Stopped because the time budget ran out (resubmit with `resumeSkip`). */
	interrupted: boolean;
	fileName: string;
	compression: Compression;
	format: ImportFormat;
	/** Queries (SQL statements, or inserted CSV rows) executed. */
	queries: number;
	skipped: number;
	bytesRead: number;
	durationMs: number;
	/** Human readable summary (phpMyAdmin wording). */
	message: string;
	error: ImportErrorInfo | null;
	/** `skip_queries` value that continues after the last handled unit (after the failing one on error). */
	resumeSkip: number | null;
	/** `skip_queries` value that retries the failing unit. */
	retrySkip: number | null;
	statements: ImportStatementInfo[];
	statementsTruncated: boolean;
	warnings: ImportWarningInfo[];
	affectedRows: number;
	/** Databases / tables created by the import (for links and the navigation refresh). */
	created: { db: string; tables: string[] }[];
	/** The set of databases or tables may have changed: reload the navigation tree. */
	structureChanged: boolean;
	/** Database selected by the file (`USE`) when it differs from the page's. */
	currentDb: string | null;
}

/** One NDJSON line of the `/api/import` response. */
export type ImportEvent =
	| { t: 'progress'; bytes: number; queries: number; ms: number }
	| { t: 'done'; result: ImportResult }
	| { t: 'error'; message: string };

/** Options object posted by the page (all values as strings/booleans; parsed with zod server side). */
export type ImportOptionValues = Record<string, string | boolean | number>;

export interface ImportRequestOptions {
	format: ImportFormat | 'auto';
	charset: string;
	allowInterrupt: boolean;
	skipQueries: number;
	fkChecks: boolean;
	options: ImportOptionValues;
}
