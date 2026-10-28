import { getReplication } from '#lib/server/admin/replication.ts';
import { getStatusData, summarize } from '#lib/server/admin/status.ts';
import { replicaField } from '#lib/admin/statements.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const conn = await locals.db;
	const dbi = await locals.dbi;
	const [{ status }, info] = await Promise.all([getStatusData(conn), dbi.getServerInfo()]);
	const repl = await getReplication(conn, info);
	const isReplica = repl.replicas.length > 0;
	return {
		summary: summarize(status),
		questions: Number(status.Questions ?? 0) || 0,
		replication: {
			isPrimary: repl.primary !== null,
			isReplica,
			primaryFile: repl.primary?.File ?? '',
			primaryPosition: repl.primary?.Position ?? '',
			replicaIo: isReplica ? replicaField(repl.replicas[0], 'Slave_IO_Running') : '',
			replicaSql: isReplica ? replicaField(repl.replicas[0], 'Slave_SQL_Running') : ''
		}
	};
};
