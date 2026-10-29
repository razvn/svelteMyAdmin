import { error } from '@sveltejs/kit';
import PDFDocument from 'pdfkit';
import type { RequestHandler } from './$types';

const MAX_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

/** Wrap the PNG rendering of the map (posted as the request body) in a one-page PDF. */
export const POST: RequestHandler = async ({ request, url }) => {
	const bytes = Buffer.from(await request.arrayBuffer());
	if (bytes.length === 0 || bytes.length > MAX_BYTES) error(400, 'Invalid image');
	if (!PNG_SIGNATURE.every((b, i) => bytes[i] === b)) error(400, 'Invalid image');
	// the PNG is rendered at 2x: PDF points are 1/72 inch, keep the on-screen size
	const width = Math.min(Math.max(Number(url.searchParams.get('width')) || 800, 50), 5000);
	const height = Math.min(Math.max(Number(url.searchParams.get('height')) || 600, 50), 5000);
	const margin = 20;
	const doc = new PDFDocument({
		size: [width + 2 * margin, height + 2 * margin],
		margin,
		info: { Title: 'GIS visualization', Creator: 'svelteMyAdmin' }
	});
	const chunks: Buffer[] = [];
	doc.on('data', (c: Buffer) => chunks.push(c));
	const done = new Promise<void>((resolve) => doc.on('end', () => resolve()));
	try {
		doc.image(bytes, margin, margin, { width, height });
	} catch {
		error(400, 'Invalid image');
	}
	doc.end();
	await done;
	return new Response(Buffer.concat(chunks), {
		headers: {
			'content-type': 'application/pdf',
			'content-disposition': 'attachment; filename="gis-visualization.pdf"'
		}
	});
};
