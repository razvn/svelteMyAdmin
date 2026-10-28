/** Query templates of the table SQL page (templates/sql/query.twig buttons). */
import { escapeId } from './escape.ts';

export type TemplateName = 'select-all' | 'select' | 'insert' | 'update' | 'delete';

export function queryTemplate(name: TemplateName, table: string, columns: string[]): string {
	const t = escapeId(table);
	const cols = columns.map(escapeId);
	switch (name) {
		case 'select-all':
			return `SELECT * FROM ${t} WHERE 1`;
		case 'select':
			return `SELECT ${cols.join(', ')}\nFROM ${t}\nWHERE 1`;
		case 'insert':
			return `INSERT INTO ${t}\n(${cols.join(', ')})\nVALUES (${cols.map(() => '').join(', ')})`;
		case 'update':
			return `UPDATE ${t}\nSET ${cols.map((c) => `${c} = `).join(',\n    ')}\nWHERE `;
		case 'delete':
			return `DELETE FROM ${t}\nWHERE `;
	}
}
