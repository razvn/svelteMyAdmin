import { format } from 'sql-formatter';

export type SqlDialect = 'mysql' | 'mariadb';

/** Pretty-print SQL (phpMyAdmin's "Format" button); returns the input unchanged when it cannot be parsed. */
export function formatSql(sql: string, dialect: SqlDialect = 'mysql'): string {
	if (sql.trim() === '') return sql;
	try {
		return format(sql, {
			language: dialect,
			keywordCase: 'upper',
			dataTypeCase: 'upper',
			functionCase: 'upper',
			identifierCase: 'preserve',
			tabWidth: 4,
			linesBetweenQueries: 1
		});
	} catch {
		return sql;
	}
}
