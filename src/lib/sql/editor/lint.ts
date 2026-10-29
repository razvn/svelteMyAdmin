/**
 * Client-side SQL sanity checker (unbalanced quotes, backticks, parentheses, block comments).
 * It is deliberately not a parser: phpMyAdmin lints server-side with its PHP parser, here we only
 * flag the mistakes that can be detected reliably with a single scan.
 */
import { N_ } from '#lib/i18n/translator.ts';

export interface LintIssue {
	from: number;
	to: number;
	severity: 'error' | 'warning';
	/** English text (already interpolated). */
	message: string;
	/** Message id to translate with `params` (the English `message` when absent). */
	msgid?: string;
	params?: Record<string, string>;
}

export function lintSql(sql: string): LintIssue[] {
	const issues: LintIssue[] = [];
	const parens: number[] = [];
	const n = sql.length;
	let i = 0;
	while (i < n) {
		const c = sql[i];
		const next = sql[i + 1];
		if (c === '#' || (c === '-' && next === '-' && (i + 2 >= n || /\s/.test(sql[i + 2])))) {
			while (i < n && sql[i] !== '\n') i++;
		} else if (c === '/' && next === '*') {
			const end = sql.indexOf('*/', i + 2);
			if (end === -1) {
				issues.push({
					from: i,
					to: n,
					severity: 'error',
					message: 'Unterminated comment',
					msgid: N_('Unterminated comment')
				});
				i = n;
			} else i = end + 2;
		} else if (c === "'" || c === '"' || c === '`') {
			const start = i;
			i++;
			let closed = false;
			while (i < n) {
				if (c !== '`' && sql[i] === '\\') {
					i += 2;
					continue;
				}
				if (sql[i] === c) {
					if (sql[i + 1] === c) {
						i += 2;
						continue;
					}
					closed = true;
					i++;
					break;
				}
				i++;
			}
			if (!closed) {
				const ident = c === '`';
				issues.push({
					from: start,
					to: start + 1,
					severity: 'error',
					message: `Unterminated ${ident ? 'identifier' : 'string'}: missing closing ${c}`,
					msgid: ident
						? N_('Unterminated identifier: missing closing {char}')
						: N_('Unterminated string: missing closing {char}'),
					params: { char: c }
				});
				i = n;
			}
		} else {
			if (c === '(') parens.push(i);
			else if (c === ')') {
				if (parens.length === 0)
					issues.push({
						from: i,
						to: i + 1,
						severity: 'error',
						message: 'Unmatched closing parenthesis',
						msgid: N_('Unmatched closing parenthesis')
					});
				else parens.pop();
			}
			i++;
		}
	}
	for (const at of parens)
		issues.push({
			from: at,
			to: at + 1,
			severity: 'error',
			message: 'Unclosed parenthesis',
			msgid: N_('Unclosed parenthesis')
		});
	return issues.sort((a, b) => a.from - b.from);
}
