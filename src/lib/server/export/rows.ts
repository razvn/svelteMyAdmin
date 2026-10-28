/**
 * Streaming rows from MySQL for exports. Uses the callback API under the promise connection
 * (`conn.connection.query(...).stream()`), which applies back-pressure to the socket, so a huge
 * table never sits in memory. Values arrive as text (`null`, string) or Buffer (binary/bit/geometry).
 */
import type { Connection } from 'mysql2/promise';
import type { ExportCell, ExportField } from './types.ts';

interface RawField {
	name: string;
	columnType: number;
	flags: number;
	characterSet: number;
	columnLength: number;
	table: string;
	orgTable?: string;
	decimals?: number;
}

/** mysql2 column type codes (enum_field_types). */
const TYPE_NAMES: Record<number, string> = {
	0: 'decimal',
	1: 'tinyint',
	2: 'smallint',
	3: 'int',
	4: 'float',
	5: 'double',
	6: 'null',
	7: 'timestamp',
	8: 'bigint',
	9: 'mediumint',
	10: 'date',
	11: 'time',
	12: 'datetime',
	13: 'year',
	14: 'date',
	15: 'varchar',
	16: 'bit',
	245: 'json',
	246: 'decimal',
	247: 'enum',
	248: 'set',
	249: 'tinyblob',
	250: 'mediumblob',
	251: 'longblob',
	252: 'blob',
	253: 'varchar',
	254: 'char',
	255: 'geometry'
};
const NUMERIC = new Set([0, 1, 2, 3, 4, 5, 8, 9, 246]);
const BLOBLIKE = new Set([249, 250, 251, 252, 253, 254]);
const BINARY_CHARSET = 63;
const NOT_NULL_FLAG = 1;

export function toExportField(f: RawField): ExportField {
	const isBinary = BLOBLIKE.has(f.columnType) && f.characterSet === BINARY_CHARSET;
	let type = TYPE_NAMES[f.columnType] ?? 'unknown';
	if (isBinary) {
		type = f.columnType === 253 ? 'varbinary' : f.columnType === 254 ? 'binary' : type;
	} else if (BLOBLIKE.has(f.columnType) && f.columnType <= 252) {
		type = type.replace('blob', 'text');
	}
	return {
		name: f.name,
		type,
		isBinary,
		isNumeric: NUMERIC.has(f.columnType),
		nullable: (f.flags & NOT_NULL_FLAG) === 0,
		length: f.columnLength
	};
}

/** Origin table of the result columns when all come from one table, else ''. */
export function singleOriginTable(fields: RawField[]): string {
	const tables = new Set(fields.map((f) => f.orgTable || f.table).filter(Boolean));
	return tables.size === 1 ? [...tables][0] : '';
}

interface CoreQuery {
	on(event: string, cb: (...args: never[]) => void): CoreQuery;
	stream(): import('node:stream').Readable;
}
interface CoreConnection {
	query(options: Record<string, unknown>): CoreQuery;
}

export interface OpenedRows {
	fields: ExportField[];
	/** Origin table when the result comes from exactly one table. */
	originTable: string;
	rows: AsyncIterable<ExportCell[]>;
	/** Abort the query early (closing the stream). */
	destroy(): void;
}

const BUFFER_TYPES = new Set(['GEOMETRY', 'BIT']);
const NEXT_TYPES = new Set([
	'BLOB',
	'TINY_BLOB',
	'MEDIUM_BLOB',
	'LONG_BLOB',
	'VAR_STRING',
	'STRING'
]);

/**
 * Run `sql` and expose its rows as an async iterable. Resolves once the column metadata is known
 * (so syntax errors surface here, before any output), rejects for statements without a result set.
 */
export function openRowStream(conn: Connection, sql: string): Promise<OpenedRows> {
	return new Promise((resolve, reject) => {
		let settled = false;
		const core = (conn as unknown as { connection: CoreConnection }).connection;
		const query = core.query({
			sql,
			rowsAsArray: true,
			typeCast: (
				field: {
					type: string;
					string(encoding?: string): string | null;
					buffer(): Buffer | null;
				},
				next: () => unknown
			) => {
				if (BUFFER_TYPES.has(field.type)) return field.buffer();
				if (NEXT_TYPES.has(field.type)) return next();
				return field.string('utf8');
			}
		});
		query.on('fields', ((raw: RawField[]) => {
			if (settled) return;
			settled = true;
			const stream = query.stream();
			resolve({
				fields: raw.map(toExportField),
				originTable: singleOriginTable(raw),
				rows: stream as unknown as AsyncIterable<ExportCell[]>,
				destroy: () => stream.destroy()
			});
		}) as never);
		query.on('error', ((e: Error) => {
			if (!settled) {
				settled = true;
				reject(e);
			}
		}) as never);
		query.on('end', (() => {
			if (!settled) {
				settled = true;
				reject(new Error('The statement did not return a result set'));
			}
		}) as never);
	});
}
