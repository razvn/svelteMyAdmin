/**
 * Export templates in `pma__export_templates` (Export\TemplateModel). `template_data` is the JSON
 * object of the export form fields, with the same field names phpMyAdmin uses (`what`,
 * `sql_include_comments`, ...), so both applications can read each other's templates.
 */
import { withStorageTable } from '#lib/server/pmadb/index.ts';
import type { ExportScope } from './types.ts';

export interface ExportTemplate {
	id: number;
	name: string;
}

/** The `export_type` column value (`server`, `database`, `table`, `raw`). */
export type TemplateType = ExportScope;

const username = (locals: App.Locals) => locals.session?.user ?? '';

/** null = configuration storage unavailable (the templates bar is hidden). */
export async function listTemplates(
	locals: App.Locals,
	type: TemplateType
): Promise<ExportTemplate[] | null> {
	const rows = await withStorageTable(locals, 'export_templates', async (conn, table) => {
		const [r] = await conn.query(
			`SELECT \`id\`, \`template_name\` FROM ${table} WHERE \`username\` = ? AND \`export_type\` = ? ORDER BY \`template_name\``,
			[username(locals), type]
		);
		return r as { id: number; template_name: string }[];
	});
	return rows ? rows.map((r) => ({ id: Number(r.id), name: String(r.template_name) })) : null;
}

/** The stored JSON of one template of the current user, null when missing. */
export async function loadTemplate(
	locals: App.Locals,
	id: number
): Promise<Record<string, unknown> | null> {
	const row = await withStorageTable(locals, 'export_templates', async (conn, table) => {
		const [r] = await conn.query(
			`SELECT \`template_data\` FROM ${table} WHERE \`id\` = ? AND \`username\` = ?`,
			[id, username(locals)]
		);
		return (r as { template_data: string }[])[0];
	});
	if (!row) return null;
	try {
		const parsed = JSON.parse(String(row.template_data));
		return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

/** Create; returns the new id, or null when storage is unavailable or the name exists. */
export async function createTemplate(
	locals: App.Locals,
	type: TemplateType,
	name: string,
	data: Record<string, unknown>
): Promise<number | null> {
	const id = await withStorageTable(locals, 'export_templates', async (conn, table) => {
		const [r] = await conn.query(
			`INSERT INTO ${table} (\`username\`, \`export_type\`, \`template_name\`, \`template_data\`) VALUES (?, ?, ?, ?)`,
			[username(locals), type, name.slice(0, 64), JSON.stringify(data)]
		);
		return Number((r as { insertId: number }).insertId);
	});
	return id ?? null;
}

export async function updateTemplate(
	locals: App.Locals,
	id: number,
	data: Record<string, unknown>
): Promise<boolean> {
	const ok = await withStorageTable(locals, 'export_templates', async (conn, table) => {
		const [r] = await conn.query(
			`UPDATE ${table} SET \`template_data\` = ? WHERE \`id\` = ? AND \`username\` = ?`,
			[JSON.stringify(data), id, username(locals)]
		);
		return (r as { affectedRows: number }).affectedRows > 0;
	});
	return ok ?? false;
}

export async function deleteTemplate(locals: App.Locals, id: number): Promise<boolean> {
	const ok = await withStorageTable(locals, 'export_templates', async (conn, table) => {
		const [r] = await conn.query(`DELETE FROM ${table} WHERE \`id\` = ? AND \`username\` = ?`, [
			id,
			username(locals)
		]);
		return (r as { affectedRows: number }).affectedRows > 0;
	});
	return ok ?? false;
}
