import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** Partitions are shown on the Structure page. */
export const GET: RequestHandler = ({ params }) => {
	const base = `/db/${encodeURIComponent(params.db)}/table/${encodeURIComponent(params.table)}`;
	redirect(307, `${base}/structure#partitions`);
};
