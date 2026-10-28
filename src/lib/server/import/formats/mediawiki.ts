/**
 * MediaWiki table markup reader (Plugins/Import/ImportMediawiki.php): `{| ... |}` tables with
 * `|-` row separators, `!` header cells and `|` data cells. Table names come from phpMyAdmin's
 * "Table data for `name`" comments (or the `|+` caption); "Table structure" sections are skipped.
 */
import type { Cell } from '../analyze.ts';

export interface WikiTable {
	/** '' when the markup carries no name. */
	name: string;
	headers: string[];
	rows: Cell[][];
}

export class MediaWikiError extends Error {
	constructor(
		readonly lineText: string,
		readonly line: number
	) {
		super(`Invalid format of mediawiki input on line ${line}: ${lineText}`);
		this.name = 'MediaWikiError';
	}
}

/** Split on `||`, except inside `<tag attr="a||b">` markup. */
export function explodeMarkup(text: string): string[] {
	const out: string[] = [];
	let cur = '';
	let inTag = false;
	let quote = '';
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '|' && text[i + 1] === '|' && !inTag) {
			out.push(cur);
			cur = '';
			i++;
			continue;
		}
		if (inTag) {
			if (quote) {
				if (c === quote) quote = '';
			} else if (c === '"' || c === "'") quote = c;
			else if (c === '>') inTag = false;
		} else if (c === '<') inTag = true;
		cur += c;
	}
	out.push(cur);
	return out;
}

const ATTRS = /^\s*(?:[\w:-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'|]+)\s*)+$/;

/** `style="x" | value` => `value`; a `|` after wiki links (`[[a|b]]`) is not an attribute separator. */
function cellContent(raw: string): string {
	let cell = raw.trim();
	for (const ch of ['|', '!']) {
		if (cell.startsWith(ch)) cell = cell.slice(1).trim();
	}
	const bar = cell.indexOf('|');
	if (bar !== -1 && !cell.slice(0, bar).includes('[[') && ATTRS.test(cell.slice(0, bar))) {
		cell = cell.slice(bar + 1).trim();
	}
	return cell;
}

export function parseMediaWiki(text: string): WikiTable[] {
	const tables: WikiTable[] = [];
	let insideComment = false;
	let insideData = false;
	let insideStructure = false;
	let tableName = '';
	let caption = '';
	let headers: string[] = [];
	let rows: Cell[][] = [];
	let curLine: string[] = [];
	let inHeader = false;
	let open = false;

	const lines = text.split('\n');
	for (let n = 0; n < lines.length; n++) {
		const line = lines[n].trim();
		if (line === '') continue;

		if (line.startsWith('<!--')) {
			insideComment = true;
			if (line.length > 4 && line.endsWith('-->')) insideComment = insideStructure || insideData;
			continue;
		}
		if (insideComment) {
			if (line === '-->') {
				if (insideData) insideData = false;
				if (!insideStructure) insideComment = false;
			} else {
				const data = /^Table data for `(.*)`$/.exec(line);
				const struct = /^Table structure for `(.*)`$/.exec(line);
				if (data) {
					tableName = data[1];
					insideData = true;
					insideStructure = false;
				} else if (struct) {
					insideStructure = true;
				}
			}
			continue;
		}

		if (line.startsWith('{|')) {
			rows = [];
			headers = [];
			curLine = [];
			caption = '';
			inHeader = false;
			open = true;
		} else if (line.startsWith('|-') || line.startsWith('|+') || line.startsWith('|}')) {
			if (line.startsWith('|+')) {
				caption = line.slice(2).replace(/'''/g, '').trim();
				continue;
			}
			if (curLine.length > 0) {
				if (inHeader) headers = curLine as string[];
				else rows.push(curLine);
			}
			curLine = [];
			inHeader = false;
			if (line.startsWith('|}') && open) {
				tables.push({ name: tableName || caption, headers, rows });
				tableName = '';
				open = false;
				headers = [];
				rows = [];
			}
		} else if (line[0] === '|' || line[0] === '!') {
			let l = line;
			if (line[0] === '!') {
				l = l.replaceAll('!!', '||');
				inHeader = true;
			} else {
				inHeader = false;
			}
			for (const cell of explodeMarkup(l)) curLine.push(cellContent(cell));
		} else {
			throw new MediaWikiError(line, n + 1);
		}
	}
	return tables;
}
