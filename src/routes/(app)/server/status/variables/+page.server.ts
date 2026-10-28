import { STATUS_DESCRIPTIONS } from '#lib/admin/status-descriptions.ts';
import { buildVariables } from '#lib/admin/status-vars.ts';
import { getStatusData } from '#lib/server/admin/status.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const { status, variables } = await getStatusData(await locals.db);
	return { variables: buildVariables(status, variables, STATUS_DESCRIPTIONS) };
};
