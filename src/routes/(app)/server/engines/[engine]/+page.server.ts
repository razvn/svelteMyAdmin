import { error } from '@sveltejs/kit';
import {
	findEngine,
	getInnodbStatus,
	hasInnodbStatus,
	listEngineVariables
} from '#lib/server/admin/engines.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, params }) => {
	const conn = await locals.db;
	const engine = await findEngine(conn, params.engine);
	if (!engine) error(404, 'Unknown storage engine.');
	const [variables, innodbStatus] = await Promise.all([
		listEngineVariables(conn, engine.name),
		hasInnodbStatus(engine.name) && engine.support !== 'NO' && engine.support !== 'DISABLED'
			? getInnodbStatus(conn)
			: Promise.resolve(null)
	]);
	return { engine, variables, innodbStatus };
};
