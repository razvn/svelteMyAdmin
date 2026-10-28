/**
 * phpMyAdmin XML export format (Plugins/Import/ImportXml.php, Plugins/Export/ExportXml.php):
 *
 *   <pma_xml_export><pma:structure_schemas><pma:database name collation charset>
 *       <pma:table name>CREATE TABLE ...</pma:table> ...
 *   </pma:database></pma:structure_schemas>
 *   <database name><table name><column name>value</column>...</table>...</database></pma_xml_export>
 *
 * Each `<table>` element of the data section is one row. A cell with the text `NULL` is NULL
 * (the exporter cannot tell them apart).
 */
import type { TableData } from '../build.ts';
import { elementChildren, parseXml, textContent, XmlError, type XmlElement } from './xml.ts';

export interface XmlStructure {
	kind: string;
	name: string;
	sql: string;
}

export interface PmaXml {
	dbName: string;
	collation: string | null;
	charset: string | null;
	structure: XmlStructure[];
	tables: TableData[];
}

export class XmlFormatError extends Error {
	constructor() {
		super(
			'The XML file specified was either malformed or incomplete. Please correct the issue and try again.'
		);
		this.name = 'XmlFormatError';
	}
}

export function parsePmaXml(text: string): PmaXml {
	let root: XmlElement;
	try {
		root = parseXml(text);
	} catch (e) {
		if (e instanceof XmlError) throw new XmlFormatError();
		throw e;
	}

	let dbName = '';
	let collation: string | null = null;
	let charset: string | null = null;
	const structure: XmlStructure[] = [];
	const rowsByTable = new Map<string, { cols: string[]; rows: Map<string, string | null>[] }>();

	for (const child of elementChildren(root)) {
		if (child.name === 'pma:structure_schemas') {
			for (const db of elementChildren(child)) {
				if (db.name !== 'pma:database') continue;
				dbName = db.attrs.name ?? '';
				collation = db.attrs.collation || null;
				charset = db.attrs.charset || null;
				for (const obj of elementChildren(db)) {
					const sql = textContent(obj).replaceAll('                ', '').trim().replace(/;$/, '');
					if (sql !== '')
						structure.push({
							kind: obj.name.replace(/^pma:/, ''),
							name: obj.attrs.name ?? '',
							sql
						});
				}
			}
		} else if (!child.name.startsWith('pma:') && child.name === 'database') {
			if (dbName === '') dbName = child.attrs.name ?? '';
			for (const tbl of elementChildren(child)) {
				if (tbl.name !== 'table') continue;
				const name = tbl.attrs.name ?? '';
				let t = rowsByTable.get(name);
				if (!t) rowsByTable.set(name, (t = { cols: [], rows: [] }));
				const row = new Map<string, string | null>();
				for (const col of elementChildren(tbl)) {
					const cn = col.attrs.name ?? '';
					if (!t.cols.includes(cn)) t.cols.push(cn);
					const v = textContent(col);
					row.set(cn, v === 'NULL' ? null : v);
				}
				t.rows.push(row);
			}
		}
	}
	if (dbName === '') throw new XmlFormatError();

	const tables: TableData[] = [...rowsByTable].map(([name, t]) => ({
		name,
		colNames: t.cols,
		rows: t.rows.map((r) => t.cols.map((c) => r.get(c) ?? null))
	}));
	return { dbName, collation, charset, structure, tables };
}
