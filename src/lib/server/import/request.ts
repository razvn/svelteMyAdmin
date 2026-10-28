/** Validation of the `/api/import` request (zod): scope from the query string, options from a header. */
import { z } from 'zod';
import { FILE_CHARSETS } from '#lib/import/options.ts';
import { IMPORT_FORMATS, type ImportRequestOptions, type ImportScope } from '#lib/import/types.ts';

const charsets = new Set(FILE_CHARSETS.map((c) => c.value));

const optionsSchema = z.object({
	format: z.enum(['auto', ...IMPORT_FORMATS]).default('auto'),
	charset: z
		.string()
		.max(40)
		.refine((c) => c === '' || charsets.has(c), 'Unsupported character set')
		.default('utf-8'),
	allow_interrupt: z.boolean().default(true),
	skip_queries: z.number().int().min(0).max(2_000_000_000).default(0),
	fk_checks: z.boolean().default(true),
	options: z
		.record(z.string().max(64), z.union([z.string().max(2000), z.boolean(), z.number()]))
		.default({})
});

const scopeSchema = z.object({
	db: z.string().min(1).max(64).optional(),
	table: z.string().min(1).max(64).optional()
});

export function parseScope(params: URLSearchParams): ImportScope | null {
	const p = scopeSchema.safeParse({
		db: params.get('db') ?? undefined,
		table: params.get('table') ?? undefined
	});
	if (!p.success) return null;
	if (p.data.table && !p.data.db) return null;
	if (p.data.db && p.data.table) return { level: 'table', db: p.data.db, table: p.data.table };
	if (p.data.db) return { level: 'db', db: p.data.db };
	return { level: 'server' };
}

export function parseFileName(header: string | null): string | null {
	if (!header) return null;
	try {
		const name = decodeURIComponent(header).split(/[\\/]/).pop()!.slice(0, 255);
		return name === '' ? null : name;
	} catch {
		return null;
	}
}

export function parseRequestOptions(header: string | null): ImportRequestOptions | null {
	let json: unknown = {};
	if (header) {
		try {
			json = JSON.parse(decodeURIComponent(header));
		} catch {
			return null;
		}
	}
	const p = optionsSchema.safeParse(json);
	if (!p.success) return null;
	return {
		format: p.data.format,
		charset: p.data.charset || 'utf-8',
		allowInterrupt: p.data.allow_interrupt,
		skipQueries: p.data.skip_queries,
		fkChecks: p.data.fk_checks,
		options: p.data.options
	};
}
