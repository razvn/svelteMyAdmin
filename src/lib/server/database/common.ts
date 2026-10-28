/**
 * Helpers shared by the routines / events / triggers services.
 */
import type { Connection } from '../db/connection';
import { escapeId } from '../db/escape';

export type Row = Record<string, unknown>;

export const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export async function rows(conn: Connection, sql: string, params: unknown[] = []): Promise<Row[]> {
	const [result] = await conn.query(sql, params);
	return result as Row[];
}

/** MySQL's own message (`sqlMessage`) only; never stack traces. */
export function sqlErrorMessage(err: unknown, fallback = 'The statement failed.'): string {
	const sqlMessage = (err as { sqlMessage?: unknown } | null)?.sqlMessage;
	return typeof sqlMessage === 'string' && sqlMessage !== '' ? sqlMessage : fallback;
}

export interface SaveResult {
	ok: boolean;
	errors: string[];
	/** The statements that were run, for display. */
	queries: string[];
	/** True when the original was re-created after a failure. */
	rolledBack?: boolean;
}

/**
 * Create or replace an object the way phpMyAdmin does: when editing, remember the original
 * definition, DROP it, run CREATE and, if CREATE fails, try to re-create the original.
 */
export async function createOrReplace(
	conn: Connection,
	db: string,
	opts: { createSql: string; dropSql?: string; originalSql?: string | null }
): Promise<SaveResult> {
	const queries: string[] = [];
	try {
		await conn.query(`USE ${escapeId(db)}`);
		if (opts.dropSql) {
			queries.push(opts.dropSql);
			await conn.query(opts.dropSql);
		}
		queries.push(opts.createSql);
		await conn.query(opts.createSql);
		return { ok: true, errors: [], queries };
	} catch (err) {
		const errors = [sqlErrorMessage(err)];
		let rolledBack = false;
		if (opts.dropSql && opts.originalSql) {
			try {
				await conn.query(opts.originalSql);
				rolledBack = true;
				errors.push('The original definition was restored.');
			} catch (rollbackErr) {
				errors.push(
					`The original could not be restored: ${sqlErrorMessage(rollbackErr)} Original definition: ${opts.originalSql}`
				);
			}
		}
		return { ok: false, errors, queries, rolledBack };
	}
}

/** Run SHOW CREATE and return the column holding the statement (null when hidden by privileges). */
export async function showCreate(
	conn: Connection,
	sql: string,
	column: string
): Promise<string | null> {
	const [r] = await rows(conn, sql);
	if (!r) return null;
	const v = r[column];
	return v === null || v === undefined ? null : String(v);
}
