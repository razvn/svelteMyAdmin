/**
 * Export plugin registry. Keep this a plain array of imports: other format plugins append one import
 * and one array entry (merge friendly). Order = order in the format select.
 */
import type { ExportPlugin, ExportScope } from './types.ts';
import sql from './plugins/sql.ts';

export const exportPlugins: ExportPlugin[] = [sql];

export function getExportPlugin(id: string): ExportPlugin | undefined {
	return exportPlugins.find((p) => p.id === id);
}

/** Plugins that can export the given scope (phpMyAdmin hides formats per export type). */
export function pluginsForScope(scope: ExportScope): ExportPlugin[] {
	return exportPlugins.filter((p) => p.scopes.includes(scope));
}
