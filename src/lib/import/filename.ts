import { FORMAT_EXTENSIONS, type Compression, type ImportFormat } from './types.ts';

export interface FileNameInfo {
	/** Name without the compression suffix. */
	innerName: string;
	compression: Compression;
	format: ImportFormat | null;
}

const COMPRESSION_EXT: Record<string, Compression> = {
	gz: 'gzip',
	gzip: 'gzip',
	zip: 'zip',
	bz2: 'bzip2',
	bzip2: 'bzip2'
};

/** `dump.sql.gz` => sql + gzip. A name ending in `.ods` is a spreadsheet, not a compressed file. */
export function parseFileName(fileName: string): FileNameInfo {
	const base = fileName.split(/[\\/]/).pop() ?? fileName;
	const parts = base.split('.');
	let compression: Compression = 'none';
	if (parts.length > 1) {
		const c = COMPRESSION_EXT[parts[parts.length - 1].toLowerCase()];
		if (c) {
			compression = c;
			parts.pop();
		}
	}
	const innerName = parts.join('.');
	const ext = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
	return { innerName, compression, format: FORMAT_EXTENSIONS[ext] ?? null };
}
