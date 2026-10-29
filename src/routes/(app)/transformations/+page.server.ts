import {
	INPUT_PLUGINS,
	OUTPUT_PLUGINS,
	mimeTypes,
	pluginListName
} from '#lib/transformations/registry.ts';
import type { PageServerLoad } from './$types';

/** Transformations overview (Controllers/Transformation/OverviewController). */
export const load: PageServerLoad = () => {
	const row = (p: (typeof OUTPUT_PLUGINS)[number] | (typeof INPUT_PLUGINS)[number]) => ({
		name: pluginListName(p),
		title: p.title,
		description: p.description,
		unsupported: !!p.unsupported
	});
	return {
		mimeTypes: mimeTypes(),
		transformations: OUTPUT_PLUGINS.map(row),
		inputTransformations: INPUT_PLUGINS.map(row)
	};
};
