/** Input transformations of the insert/edit form (render the custom widget, convert on save). */
import type { FormRow, Submission } from '#lib/server/table/insert-edit.ts';
import { InsertEditError, type FormColumn } from '#lib/sql/insert-edit.ts';
import { getOptions } from '#lib/transformations/options.ts';
import { resolveInput } from '#lib/transformations/registry.ts';
import { loadMime } from './column-info.ts';

/** Mark the columns that have an input transformation. */
export async function attachInputTransforms(
	locals: App.Locals,
	db: string,
	table: string,
	columns: FormColumn[]
): Promise<FormColumn[]> {
	const mime = await loadMime(locals, db, table);
	if (!mime || mime.size === 0) return columns;
	return columns.map((col) => {
		const row = mime.get(col.name);
		const plugin = resolveInput(row?.input_transformation);
		if (!row || !plugin || col.generated) return col;
		return {
			...col,
			inputTransform: {
				id: plugin.id,
				widget: plugin.widget,
				language: plugin.language,
				options: getOptions(row.input_transformation_options)
			}
		};
	});
}

/** Show stored values the way the plugin edits them (Iptolong: dotted quad instead of the integer). */
export function toFormValues(columns: FormColumn[], rows: FormRow[]): void {
	columns.forEach((col, c) => {
		const plugin = resolveInput(col.inputTransform?.id);
		if (!plugin?.toForm) return;
		const isBinary = col.kind === 'binary';
		for (const row of rows) {
			const cell = row.cells[c];
			if (cell.isNull || cell.value === '') continue;
			const shown = plugin.toForm(cell.value, { isBinary });
			cell.value = shown;
			if (cell.prev !== undefined) cell.prev = shown;
		}
	});
}

/** Convert the submitted values; throws InsertEditError when a plugin rejects one. */
export function applyInputTransforms(sub: Submission, columns: FormColumn[]): void {
	columns.forEach((col, c) => {
		const plugin = resolveInput(col.inputTransform?.id);
		if (!plugin || plugin.widget === 'file' || plugin.widget === 'image') return;
		const isBinary = col.kind === 'binary';
		for (const row of sub.rows) {
			const input = row.cells[c];
			const { cell } = input;
			if (cell.isNull || cell.func || input.upload || cell.value === '') continue;
			if (cell.prev !== undefined && cell.value === cell.prev) continue;
			const res = plugin.apply(cell.value, col.inputTransform?.options ?? [], { isBinary });
			if (res.error) throw new InsertEditError(`Column ${col.name}: ${res.error}`);
			cell.value = res.value;
		}
	});
}
