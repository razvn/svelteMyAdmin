/**
 * Limits of an import: upload size (adapter-node `BODY_SIZE_LIMIT` and `Import.max_upload_size`),
 * the time budget (`ExecTimeLimit`) and the in-memory cap of buffered formats (`MemoryLimit`).
 */

/** Parse `512K`, `10M`, `2G`, a plain number of bytes or `Infinity`; undefined when not set/invalid. */
export function parseByteSize(value: unknown): number | undefined {
	if (typeof value === 'number')
		return Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined;
	if (typeof value !== 'string') return undefined;
	const v = value.trim();
	if (v === '' || /^infinity$/i.test(v)) return undefined;
	const m = /^(\d+(?:\.\d+)?)\s*([kmg]?)b?$/i.exec(v);
	if (!m) return undefined;
	const mult = { '': 1, k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[
		m[2].toLowerCase() as '' | 'k' | 'm' | 'g'
	];
	const n = Math.floor(parseFloat(m[1]) * mult);
	return n > 0 ? n : undefined;
}

/**
 * Largest accepted upload in bytes, undefined = unlimited. adapter-node rejects bigger request
 * bodies itself (default 512K) unless `BODY_SIZE_LIMIT` is raised: set e.g. `BODY_SIZE_LIMIT=2G`
 * (`Infinity` disables the limit). `Import.max_upload_size` can lower the limit further.
 */
export function maxUploadBytes(
	importConfig: Record<string, unknown> = {},
	env: Record<string, string | undefined> = process.env
): number | undefined {
	const fromEnv = parseByteSize(env.BODY_SIZE_LIMIT);
	const fromConfig = parseByteSize(importConfig.max_upload_size);
	if (fromEnv && fromConfig) return Math.min(fromEnv, fromConfig);
	return fromEnv ?? fromConfig;
}

/** Time after which an interruptible import stops (PHP: `max_execution_time - 5`). 0 = unlimited. */
export function timeBudgetMs(execTimeLimit: number): number {
	if (!(execTimeLimit > 0)) return 0;
	return execTimeLimit > 5 ? (execTimeLimit - 5) * 1000 : Math.round(execTimeLimit * 800);
}

export const DEFAULT_MEMORY_LIMIT = 512 * 1024 * 1024;

/** `$cfg['MemoryLimit']` ('-1' / '0' / '' = the built-in cap) for formats that are read into memory. */
export function memoryLimitBytes(value: unknown): number {
	return parseByteSize(value) ?? DEFAULT_MEMORY_LIMIT;
}
