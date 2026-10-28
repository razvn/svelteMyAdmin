/**
 * Minimal non-validating XML parser (elements, attributes, text, CDATA, comments, processing
 * instructions, DOCTYPE skipped, the five predefined and numeric entities). No external entity or
 * DTD processing, so it is safe for untrusted uploads. Used by the ODS and XML importers.
 */

export interface XmlElement {
	/** Qualified name as written, e.g. `table:table-row`. */
	name: string;
	attrs: Record<string, string>;
	children: (XmlElement | string)[];
}

export class XmlError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'XmlError';
	}
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decode(s: string): string {
	if (!s.includes('&')) return s;
	return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
		if (e[0] === '#') {
			const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
			try {
				return String.fromCodePoint(code);
			} catch {
				return m;
			}
		}
		return ENTITIES[e] ?? m;
	});
}

const NAME_END = /[\s/>=]/;

export function parseXml(src: string): XmlElement {
	let i = 0;
	const len = src.length;
	const stack: XmlElement[] = [];
	let root: XmlElement | null = null;

	const addText = (t: string) => {
		if (stack.length === 0) return;
		if (t !== '') stack[stack.length - 1].children.push(t);
	};

	while (i < len) {
		const lt = src.indexOf('<', i);
		if (lt === -1) {
			if (src.slice(i).trim() !== '') throw new XmlError('Text outside the root element');
			break;
		}
		if (lt > i) {
			const text = src.slice(i, lt);
			if (stack.length === 0) {
				if (text.trim() !== '') throw new XmlError('Text outside the root element');
			} else addText(decode(text));
		}
		i = lt;
		if (src.startsWith('<!--', i)) {
			const e = src.indexOf('-->', i + 4);
			if (e === -1) throw new XmlError('Unterminated comment');
			i = e + 3;
		} else if (src.startsWith('<![CDATA[', i)) {
			const e = src.indexOf(']]>', i + 9);
			if (e === -1) throw new XmlError('Unterminated CDATA section');
			addText(src.slice(i + 9, e));
			i = e + 3;
		} else if (src.startsWith('<?', i)) {
			const e = src.indexOf('?>', i + 2);
			if (e === -1) throw new XmlError('Unterminated processing instruction');
			i = e + 2;
		} else if (src.startsWith('<!', i)) {
			// DOCTYPE, possibly with an internal subset in brackets.
			let depth = 0;
			let j = i + 2;
			for (; j < len; j++) {
				const c = src[j];
				if (c === '[') depth++;
				else if (c === ']') depth--;
				else if (c === '>' && depth <= 0) break;
			}
			if (j >= len) throw new XmlError('Unterminated declaration');
			i = j + 1;
		} else if (src[i + 1] === '/') {
			const e = src.indexOf('>', i);
			if (e === -1) throw new XmlError('Unterminated end tag');
			const name = src.slice(i + 2, e).trim();
			const open = stack.pop();
			if (!open || open.name !== name) throw new XmlError(`Unexpected end tag </${name}>`);
			i = e + 1;
		} else {
			let j = i + 1;
			while (j < len && !NAME_END.test(src[j])) j++;
			const el: XmlElement = { name: src.slice(i + 1, j), attrs: {}, children: [] };
			if (el.name === '') throw new XmlError('Invalid start tag');
			const parent = stack[stack.length - 1];
			if (parent) parent.children.push(el);
			else if (root !== null) throw new XmlError('Multiple root elements');
			else root = el;
			// attributes
			for (;;) {
				while (j < len && /\s/.test(src[j])) j++;
				if (j >= len) throw new XmlError('Unterminated start tag');
				if (src[j] === '>') {
					j++;
					stack.push(el);
					break;
				}
				if (src[j] === '/' && src[j + 1] === '>') {
					j += 2;
					break;
				}
				let k = j;
				while (k < len && !NAME_END.test(src[k])) k++;
				const attr = src.slice(j, k);
				if (attr === '') throw new XmlError('Invalid attribute');
				while (k < len && /\s/.test(src[k])) k++;
				if (src[k] !== '=') throw new XmlError(`Attribute ${attr} has no value`);
				k++;
				while (k < len && /\s/.test(src[k])) k++;
				const q = src[k];
				if (q !== '"' && q !== "'") throw new XmlError(`Attribute ${attr} is not quoted`);
				const e = src.indexOf(q, k + 1);
				if (e === -1) throw new XmlError('Unterminated attribute value');
				el.attrs[attr] = decode(src.slice(k + 1, e));
				j = e + 1;
			}
			i = j;
		}
	}
	if (stack.length > 0) throw new XmlError(`Unclosed element <${stack[stack.length - 1].name}>`);
	if (!root) throw new XmlError('No root element');
	return root;
}

export function elementChildren(el: XmlElement): XmlElement[] {
	return el.children.filter((c): c is XmlElement => typeof c !== 'string');
}

/** Concatenated text content of an element. */
export function textContent(el: XmlElement): string {
	return el.children.map((c) => (typeof c === 'string' ? c : textContent(c))).join('');
}

/** Local part of a qualified name. */
export const localName = (name: string): string => name.slice(name.indexOf(':') + 1);
