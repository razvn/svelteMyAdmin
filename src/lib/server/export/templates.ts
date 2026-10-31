/**
 * Export templates in `pma__export_templates` (Export\TemplateModel). `template_data` is the JSON
 * object of the export form fields, with the same field names phpMyAdmin uses (`what`,
 * `sql_include_comments`, ...), so both applications can read each other's templates.
 */
import { withRepo } from '#lib/server/storage/index.ts';
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
	const rows = await withRepo(locals, 'exportTemplates', (repo) =>
		repo.list(username(locals), type)
	);
	return rows ?? null;
}

/** The stored JSON of one template of the current user, null when missing. */
export async function loadTemplate(
	locals: App.Locals,
	id: number
): Promise<Record<string, unknown> | null> {
	const text = await withRepo(locals, 'exportTemplates', (repo) => repo.get(id, username(locals)));
	if (text === undefined || text === null) return null;
	try {
		const parsed = JSON.parse(text);
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
	const id = await withRepo(locals, 'exportTemplates', (repo) =>
		repo.create(username(locals), type, name.slice(0, 64), JSON.stringify(data))
	);
	return id ?? null;
}

export async function updateTemplate(
	locals: App.Locals,
	id: number,
	data: Record<string, unknown>
): Promise<boolean> {
	const ok = await withRepo(locals, 'exportTemplates', (repo) =>
		repo.update(id, username(locals), JSON.stringify(data))
	);
	return ok ?? false;
}

export async function deleteTemplate(locals: App.Locals, id: number): Promise<boolean> {
	const ok = await withRepo(locals, 'exportTemplates', (repo) => repo.delete(id, username(locals)));
	return ok ?? false;
}
