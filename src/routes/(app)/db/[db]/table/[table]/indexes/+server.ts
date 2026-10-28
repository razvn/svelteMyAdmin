import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

/** The index editor lives on the Structure page (as a dialog). */
export const GET: RequestHandler = ({ params }) => {
	const base = `/db/${encodeURIComponent(params.db)}/table/${encodeURIComponent(params.table)}`;
	redirect(307, `${base}/structure#indexes`);
};
