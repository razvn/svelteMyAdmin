/** Attach browser display transformations to the result sets of the SQL console. */
import type { ScriptResult } from '#lib/sql/run-types.ts';
import { loadMime, type MimeMap } from './column-info.ts';
import { fieldTargets, transformCells, type RowTransforms } from './apply.ts';

export async function attachTransforms(locals: App.Locals, result: ScriptResult): Promise<void> {
	if (!locals.config.BrowseMIME || !locals.server.pmadb || !locals.server.column_info) return;
	const cache = new Map<string, Promise<MimeMap | null>>();
	const mimeOf = (db: string, table: string) => {
		const key = JSON.stringify([db, table]);
		let hit = cache.get(key);
		if (!hit) cache.set(key, (hit = loadMime(locals, db, table)));
		return hit;
	};
	for (const st of result.statements) {
		if (!st.ok) continue;
		for (const set of st.resultSets) {
			if (!set.rows.length) continue;
			const tables = new Map<string, { db: string; table: string }>();
			for (const f of set.fields) {
				if (f.db && f.orgTable && f.orgName) {
					tables.set(JSON.stringify([f.db, f.orgTable]), { db: f.db, table: f.orgTable });
				}
			}
			const merged: RowTransforms = {};
			for (const { db, table } of tables.values()) {
				const mime = await mimeOf(db, table);
				if (!mime || mime.size === 0) continue;
				const isSource = set.source?.db === db && set.source.table === table;
				const part = transformCells({
					db,
					table,
					mime,
					targets: fieldTargets(set.fields, db, table),
					rows: set.rows,
					signed: isSource ? set.keys : null
				});
				Object.assign(merged, part);
			}
			if (Object.keys(merged).length) set.transforms = merged;
		}
	}
}
