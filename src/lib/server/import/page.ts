/**
 * Load data of the three import pages (`/server/import`, `/db/[db]/import`,
 * `/db/[db]/table/[table]/import`): Controllers/{Server,Database,Table}/ImportController.php.
 */
import type { RequestEvent } from '@sveltejs/kit';
import {
	defaultOptionValues,
	IMPORT_CONFIG_DEFAULTS,
	sqlCompatibilities
} from '#lib/import/options.ts';
import {
	IMPORT_FORMATS,
	type ImportFormat,
	type ImportOptionValues,
	type ImportScope
} from '#lib/import/types.ts';
import { localInfileEnabled } from './drivers.ts';
import { maxUploadBytes, timeBudgetMs } from './limits.ts';

export interface ImportPageData {
	scope: ImportScope;
	/** Largest accepted upload in bytes, null = no limit configured. */
	maxUploadBytes: number | null;
	/** Seconds after which an interruptible import stops, 0 = never. */
	timeBudgetSeconds: number;
	defaults: {
		format: ImportFormat | 'auto';
		charset: string;
		allowInterrupt: boolean;
		skipQueries: number;
		fkChecks: boolean;
		options: Record<ImportFormat, ImportOptionValues>;
	};
	compatibilities: string[];
	/** `LOAD DATA LOCAL INFILE` can be used (table level and `local_infile` ON). */
	ldiAvailable: boolean;
	ldiReason: string | null;
	formats: ImportFormat[];
}

export async function loadImportPage(
	{ locals }: Pick<RequestEvent, 'locals'>,
	scope: ImportScope
): Promise<ImportPageData> {
	const config = locals.config;
	const cfg = (config.Import ?? {}) as Record<string, unknown>;
	const dbi = await locals.dbi;
	const info = await dbi.getServerInfo();
	const level = scope.level;

	let ldiAvailable = false;
	let ldiReason: string | null = null;
	if (level !== 'table') {
		ldiReason = locals.i18n.t('CSV using LOAD DATA is only available when importing into a table.');
	} else if (await localInfileEnabled({ conn: await locals.db })) {
		ldiAvailable = true;
	} else {
		ldiReason = locals.i18n.t(
			'The server variable local_infile is OFF, so LOAD DATA LOCAL INFILE cannot be used. Ask the administrator to enable it (SET GLOBAL local_infile = 1) or use the CSV format.'
		);
	}

	const options = Object.fromEntries(
		IMPORT_FORMATS.map((f) => [f, defaultOptionValues(f, level, cfg)])
	) as Record<ImportFormat, ImportOptionValues>;

	const wantedFormat = typeof cfg.format === 'string' ? cfg.format : IMPORT_CONFIG_DEFAULTS.format;
	const format = (IMPORT_FORMATS as string[]).includes(wantedFormat)
		? (wantedFormat as ImportFormat)
		: 'sql';

	return {
		scope,
		maxUploadBytes: maxUploadBytes(cfg) ?? null,
		timeBudgetSeconds: Math.round(timeBudgetMs(config.ExecTimeLimit) / 1000),
		defaults: {
			format: format === 'ldi' && !ldiAvailable ? 'sql' : format,
			charset: typeof cfg.charset === 'string' && cfg.charset ? cfg.charset : 'utf-8',
			allowInterrupt:
				typeof cfg.allow_interrupt === 'boolean'
					? cfg.allow_interrupt
					: IMPORT_CONFIG_DEFAULTS.allow_interrupt,
			skipQueries: typeof cfg.skip_queries === 'number' ? cfg.skip_queries : 0,
			fkChecks: true,
			options
		},
		compatibilities: sqlCompatibilities(info.serverType !== 'MariaDB' && info.versionInt >= 80000),
		ldiAvailable,
		ldiReason,
		formats: IMPORT_FORMATS
	};
}
