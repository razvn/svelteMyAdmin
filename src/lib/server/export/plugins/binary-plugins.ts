/** The binary (in-memory, written once in `footer`) export plugins, for the registry. */
import type { ExportPlugin } from '#lib/server/export/types.ts';
import ods from '#lib/server/export/plugins/ods.ts';
import odt from '#lib/server/export/plugins/odt.ts';
import pdf from '#lib/server/export/plugins/pdf.ts';

export const binaryPlugins: ExportPlugin[] = [ods, odt, pdf];
export default binaryPlugins;
