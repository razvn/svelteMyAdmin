import { describe, expect, it } from 'vitest';
import latex, { expandUserString } from './latex.ts';
import { texEscape } from './plugin-utils.ts';
import { booksConnection, createTestContext, fixtureData } from './testing.ts';

const STRUCTURE_HEADER = String.raw` \hline \multicolumn{1}{|c|}{\textbf{Column}} & \multicolumn{1}{|c|}{\textbf{Type}} & \multicolumn{1}{|c|}{\textbf{Null}} & \multicolumn{1}{|c|}{\textbf{Default}}`;

const DATA_HEADER = String.raw`\hline \multicolumn{1}{|c|}{\textbf{id}} & \multicolumn{1}{|c|}{\textbf{name}} & \multicolumn{1}{|c|}{\textbf{note}} & \multicolumn{1}{|c|}{\textbf{price}} & \multicolumn{1}{|c|}{\textbf{payload}} \\ \hline \hline `;

describe('latex plugin', () => {
	it('has the phpMyAdmin identity', () => {
		expect(latex.id).toBe('latex');
		expect(latex.extension).toBe('tex');
		expect(latex.mimeType).toBe('application/x-tex');
		expect(latex.supports).toEqual({ structure: true, data: true });
	});

	it('writes the structure longtable with captions, labels, escaping and key markers', async () => {
		const t = createTestContext({}, { conn: booksConnection() });
		await latex.structure?.(t.ctx, fixtureData().ref, 'structure');
		expect(t.text()).toBe(
			[
				'',
				'%',
				'% Structure: books',
				'%',
				String.raw` \begin{longtable}{|l|c|c|c|} `,
				String.raw` \caption{Structure of table books} \label{tab:books-structure} \\`,
				STRUCTURE_HEADER + String.raw` \\ \hline \hline`,
				String.raw`\endfirsthead`,
				String.raw` \caption{Structure of table books (continued)} \\ `,
				STRUCTURE_HEADER + String.raw` \\ \hline \hline \endhead \endfoot `,
				String.raw`\textbf{\textit{id}} & int & No &  \\ \hline `,
				String.raw`author\_id & int & No &  \\ \hline `,
				String.raw`\textbf{title} & varchar(200) & No &  \\ \hline `,
				String.raw`price & decimal(8,2) & No & 0.00 \\ \hline `,
				String.raw`published\_at & datetime & Yes & NULL \\ \hline `,
				String.raw`status & enum('draft', 'published', 'archived') & No & draft \\ \hline `,
				String.raw` \end{longtable}`,
				''
			].join('\n')
		);
	});

	it('writes the data longtable with the caption, continued caption and column header', async () => {
		const t = createTestContext({});
		await latex.data?.(t.ctx, fixtureData());
		expect(t.text()).toBe(
			[
				'',
				'%',
				'% Data: books',
				'%',
				String.raw` \begin{longtable}{|l|l|l|l|l|} `,
				String.raw` \hline \endhead \hline \endfoot \hline `,
				String.raw` \caption{Content of table books} \label{tab:books-data} \\` +
					DATA_HEADER +
					String.raw` \endfirsthead `,
				String.raw`\caption{Content of table books (continued)} \\ ` +
					DATA_HEADER +
					String.raw`\endhead \endfoot`,
				String.raw`1 & Plain & simple & 9.99 & bin \\ \hline `,
				'2 & Quote "x", semi;colon & line one',
				'line two\r',
				String.raw`line three & \textit{NULL} & \textit{NULL} \\ \hline `,
				'3 & Ünïcode ✓ 日本 & tab\there\\back & 0 & q"',
				'z \\\\ \\hline ',
				String.raw`4 & Apos ' \& <tag> &  & -12.50 &  \\ \hline `,
				String.raw` \end{longtable}`,
				''
			].join('\n')
		);
	});

	it('writes the data header row only with columns on, and "\\\\ \\hline" otherwise', async () => {
		const t = createTestContext({ columns: false, caption: false });
		await latex.data?.(t.ctx, fixtureData());
		expect(t.text()).toContain(String.raw`\\ \hline` + '1 & Plain');
		expect(t.text()).not.toContain('endfirsthead');
	});

	it('expands the placeholders with LaTeX escaping of the values', () => {
		expect(
			expandUserString('Table @TABLE@ of @DATABASE@', texEscape, {
				table: 'a_b',
				database: 'd%x',
				server: 'h'
			})
		).toBe(String.raw`Table a\_b of d\%x`);
	});

	it('escapes the LaTeX special characters', () => {
		expect(texEscape('100% $5 & {x} #1 a_b ^2')).toBe(String.raw`100\% \$5 \& \{x\} \#1 a\_b \^2`);
	});
});
