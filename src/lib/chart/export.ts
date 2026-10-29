/** Chart export (client only): serialize the rendered SVG with resolved styles, optionally to PNG. */

const STYLE_PROPS = [
	'fill',
	'stroke',
	'stroke-width',
	'stroke-dasharray',
	'stroke-linejoin',
	'opacity',
	'font-size',
	'font-weight',
	'font-family',
	'text-anchor',
	'dominant-baseline'
];

/** Clone `svg` with the computed paint/typography of every element inlined (CSS classes and tokens do not travel). */
export function serializeChart(svg: SVGSVGElement): { xml: string; width: number; height: number } {
	const clone = svg.cloneNode(true) as SVGSVGElement;
	const src = [svg, ...svg.querySelectorAll('*')];
	const dst = [clone, ...clone.querySelectorAll('*')];
	src.forEach((el, i) => {
		const cs = getComputedStyle(el);
		const style = STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';');
		dst[i].setAttribute('style', style);
		dst[i].removeAttribute('class');
	});
	// external content (map tiles) cannot be rasterized from an SVG image
	clone.querySelectorAll('[data-no-export]').forEach((el) => el.remove());
	const vb = svg.viewBox.baseVal;
	const width = vb.width || svg.clientWidth;
	const height = vb.height || svg.clientHeight;
	clone.setAttribute('width', String(width));
	clone.setAttribute('height', String(height));
	const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
	bg.setAttribute('width', '100%');
	bg.setAttribute('height', '100%');
	bg.setAttribute('fill', getComputedStyle(document.body).backgroundColor || '#ffffff');
	clone.insertBefore(bg, clone.firstChild);
	return { xml: new XMLSerializer().serializeToString(clone), width, height };
}

function download(blob: Blob, filename: string) {
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadSvg(svg: SVGSVGElement, filename: string) {
	const { xml } = serializeChart(svg);
	download(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }), filename);
}

export async function downloadPng(svg: SVGSVGElement, filename: string, scale = 2) {
	download(await svgToPngBlob(svg, scale), filename);
}

/** Rasterize the SVG (with inlined styles) to a PNG blob. */
export async function svgToPngBlob(svg: SVGSVGElement, scale = 2): Promise<Blob> {
	const { xml, width, height } = serializeChart(svg);
	const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }));
	try {
		const img = new Image();
		await new Promise<void>((resolve, reject) => {
			img.onload = () => resolve();
			img.onerror = () => reject(new Error('The chart could not be rendered.'));
			img.src = url;
		});
		const canvas = document.createElement('canvas');
		canvas.width = width * scale;
		canvas.height = height * scale;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('Canvas is not available.');
		ctx.scale(scale, scale);
		ctx.drawImage(img, 0, 0, width, height);
		const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
		if (!blob) throw new Error('The image could not be created.');
		return blob;
	} finally {
		URL.revokeObjectURL(url);
	}
}
