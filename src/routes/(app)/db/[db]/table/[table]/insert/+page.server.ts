import { error, fail } from '@sveltejs/kit';
import { z } from 'zod';
import { getSecret } from '#lib/server/auth/session.ts';
import { sqlErrorMessage } from '#lib/server/database/common.ts';
import {
	blankRow,
	buildFormColumns,
	buildStatements,
	executeStatements,
	loadColumns,
	loadRowsByClauses,
	nextRowClause,
	parseSubmission
} from '#lib/server/table/insert-edit.ts';
import {
	applyInputTransforms,
	attachInputTransforms,
	toFormValues
} from '#lib/server/transformations/input.ts';
import { readSignedClauses, signClause, verifyClause } from '#lib/server/table/signed-clause.ts';
import { InsertEditError, isProtected, type FormColumn } from '#lib/sql/insert-edit.ts';
import { tabHref } from '#lib/nav/tabs.ts';
import type { Actions, PageServerLoad } from './$types';

const afterSchema = z.enum(['back', 'new_insert', 'same_insert', 'edit_next']).catch('back');

/** Only same-app absolute paths are accepted as a "go back" target. */
function safeGoto(value: string | null, fallback: string): string {
	if (value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\')) {
		return value;
	}
	return fallback;
}

const insertUrl = (db: string, table: string, rows: { where: string; sig: string }[]) => {
	const base = tabHref('table', { db, table }, 'insert');
	const qs = rows
		.map((r) => `where=${encodeURIComponent(r.where)}&sig=${encodeURIComponent(r.sig)}`)
		.join('&');
	return qs ? `${base}?${qs}` : base;
};

export const load: PageServerLoad = async ({ params, url, locals, parent }) => {
	const { tableType } = await parent();
	if (tableType === 'view') error(404, 'Page not found');
	const { db, table } = params;
	const cfg = locals.config;
	const secret = getSecret(cfg.blowfish_secret);
	const clauses = readSignedClauses(url, secret, db, table);
	if (clauses === null) error(400, 'Invalid or missing row signature.');
	const sigs = url.searchParams.getAll('sig');
	const refs = clauses.map((where, i) => ({ where, sig: sigs[i] }));
	const copy = url.searchParams.get('copy') === '1' && refs.length > 0;
	const insertMode = refs.length === 0 || copy;

	const conn = await locals.db;
	const columns = await attachInputTransforms(
		locals,
		db,
		table,
		await buildFormColumns(
			conn,
			locals.server,
			db,
			table,
			await loadColumns(conn, db, table),
			cfg,
			insertMode
		)
	);

	let rows;
	let missing: string[] = [];
	if (refs.length > 0) {
		const res = await loadRowsByClauses(conn, db, table, columns, refs, {
			copy,
			defaultFunctions: cfg.DefaultFunctions
		});
		rows = res.rows;
		missing = res.missing;
	} else {
		const requested = Number(url.searchParams.get('rows'));
		const count =
			Number.isInteger(requested) && requested >= 1 && requested <= 100
				? requested
				: Math.max(1, cfg.InsertRows);
		rows = Array.from({ length: count }, () => blankRow(columns));
	}
	toFormValues(columns, rows);

	return {
		revision: crypto.randomUUID(),
		columns,
		rows,
		missing,
		mode: copy ? ('copy' as const) : refs.length > 0 ? ('edit' as const) : ('insert' as const),
		after: afterSchema.parse(url.searchParams.get('after')),
		goto: safeGoto(url.searchParams.get('goto'), tabHref('table', { db, table }, 'browse')),
		settings: {
			insertRows: Math.max(1, cfg.InsertRows),
			showFunctionFields: cfg.ShowFunctionFields,
			showFieldTypes: cfg.ShowFieldTypesInDataEditView,
			charEditing: cfg.CharEditing,
			textareaRows: cfg.TextareaRows,
			textareaCols: cfg.TextareaCols,
			charTextareaRows: Math.max(cfg.CharTextareaRows, 7),
			charTextareaCols: cfg.CharTextareaCols,
			longtextDoubleTextarea: cfg.LongtextDoubleTextarea,
			limitChars: cfg.LimitChars
		}
	};
};

export const actions: Actions = {
	default: async ({ request, params, locals }) => {
		const { db, table } = params;
		const cfg = locals.config;
		const secret = getSecret(cfg.blowfish_secret);
		const conn = await locals.db;
		const form = await request.formData();
		const after = afterSchema.parse(form.get('after_insert'));
		let statements: string[] = [];
		try {
			const columns: FormColumn[] = await attachInputTransforms(
				locals,
				db,
				table,
				(await loadColumns(conn, db, table)).map((c) => ({
					...c,
					protected: isProtected(c, cfg.ProtectBinary),
					defaultFunction: '',
					foreign: null
				}))
			);
			const sub = await parseSubmission(form, columns);
			applyInputTransforms(sub, columns);
			const built = await buildStatements(conn, db, table, columns, sub, (clause, sig) =>
				verifyClause(secret, db, table, clause, sig)
			);
			const result = await executeStatements(
				conn,
				built.statements,
				sub.submitType === 'showinsert'
			);
			statements = result.statements;

			const refs = sub.rows
				.filter((r) => r.where !== null)
				.map((r) => ({ where: r.where!, sig: r.sig! }));
			let next: string | null = null;
			if (result.executed && after === 'edit_next' && refs.length > 0) {
				const clause = await nextRowClause(conn, db, table, columns, refs[refs.length - 1].where);
				if (clause) {
					next = insertUrl(db, table, [
						{ where: clause, sig: signClause(secret, db, table, clause) }
					]);
				}
			}
			return {
				...result,
				skipped: built.skipped,
				after,
				next,
				sameUrl: insertUrl(db, table, refs),
				newUrl: insertUrl(db, table, [])
			};
		} catch (e) {
			if (e instanceof InsertEditError) return fail(400, { error: e.message, statements });
			const st = (e as { statements?: string[] }).statements ?? statements;
			return fail(400, { error: sqlErrorMessage(e), statements: st });
		}
	}
};
