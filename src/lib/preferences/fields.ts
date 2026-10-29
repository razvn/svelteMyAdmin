/**
 * Descriptor of every user-settable option: path (phpMyAdmin `config_data` key, e.g. `Export/format`),
 * control type, label/help (libraries/classes/Config/Descriptions.php) and the phpMyAdmin default
 * (libraries/config.default.php, config/Settings/*). The server value (config.json) wins over the
 * descriptor default when the key exists in the loaded config.
 */
export type FieldValue = string | number | boolean | string[];

export interface FieldOption {
	value: string | number | boolean;
	label: string;
}

export interface FieldDef {
	path: string;
	type: 'bool' | 'number' | 'text' | 'select' | 'list';
	label: string;
	help?: string;
	/** Extra note shown next to the help text (e.g. `Users cannot set a higher value`). */
	comment?: string;
	default: FieldValue;
	options?: FieldOption[];
	min?: number;
}

export const FIELDS: FieldDef[] = [
	{ path: 'Export/asfile', type: 'bool', label: 'Save as file', default: true },
	{ path: 'Export/sql_include_comments', type: 'bool', label: 'Comments', default: true },
	{ path: 'Export/sql_create_table', type: 'bool', label: 'Add CREATE TABLE', default: true },
	{ path: 'Export/sql_create_view', type: 'bool', label: 'Add CREATE VIEW', default: true },
	{
		path: 'ActionLinksMode',
		type: 'select',
		label: 'How to display various action links',
		options: [
			{
				value: 'icons',
				label: 'Icons'
			},
			{
				value: 'text',
				label: 'Text'
			},
			{
				value: 'both',
				label: 'Both'
			}
		],
		help: 'Use only icons, only text or both.',
		default: 'both'
	},
	{
		path: 'BrowseMarkerEnable',
		type: 'bool',
		label: 'Row marker',
		help: 'Highlight selected rows.',
		default: true
	},
	{
		path: 'BrowsePointerEnable',
		type: 'bool',
		label: 'Highlight pointer',
		help: 'Highlight row pointed by the mouse cursor.',
		default: true
	},
	{
		path: 'CharEditing',
		type: 'select',
		label: 'CHAR columns editing',
		options: [
			{
				value: 'input',
				label: 'input'
			},
			{
				value: 'textarea',
				label: 'textarea'
			}
		],
		help: 'Defines which type of editing controls should be used for CHAR and VARCHAR columns; input - allows limiting of input length, textarea - allows newlines in columns.',
		default: 'input'
	},
	{
		path: 'CharTextareaCols',
		type: 'number',
		label: 'CHAR textarea columns',
		help: 'Number of columns for CHAR/VARCHAR textareas.',
		default: 40,
		min: 1
	},
	{
		path: 'CharTextareaRows',
		type: 'number',
		label: 'CHAR textarea rows',
		help: 'Number of rows for CHAR/VARCHAR textareas.',
		default: 7,
		min: 1
	},
	{
		path: 'CodemirrorEnable',
		type: 'bool',
		label: 'Enable CodeMirror',
		help: 'Use user-friendly editor for editing SQL queries (CodeMirror) with syntax highlighting and line numbers.',
		default: true
	},
	{
		path: 'Confirm',
		type: 'bool',
		label: 'Confirm DROP queries',
		help: 'Whether a warning ("Are your really sure…") should be displayed when you\'re about to lose data.',
		default: true
	},
	{
		path: 'Console/AlwaysExpand',
		type: 'bool',
		label: 'Always expand query messages',
		default: false
	},
	{
		path: 'Console/CurrentQuery',
		type: 'bool',
		label: 'Show current browsing query',
		default: true
	},
	{
		path: 'Console/DarkTheme',
		type: 'bool',
		label: 'Switch to dark theme',
		default: false
	},
	{
		path: 'Console/EnterExecutes',
		type: 'bool',
		label: 'Execute queries on Enter and insert new line with Shift+Enter',
		default: false
	},
	{
		path: 'Console/GroupQueries',
		type: 'bool',
		label: 'Group queries',
		default: false
	},
	{
		path: 'Console/Height',
		type: 'number',
		label: 'Console height',
		default: 92,
		min: 1
	},
	{
		path: 'Console/Mode',
		type: 'select',
		label: 'Console mode',
		options: [
			{
				value: 'info',
				label: 'info'
			},
			{
				value: 'show',
				label: 'show'
			},
			{
				value: 'collapse',
				label: 'collapse'
			}
		],
		default: 'info'
	},
	{
		path: 'Console/Order',
		type: 'select',
		label: 'Order',
		options: [
			{
				value: 'asc',
				label: 'asc'
			},
			{
				value: 'desc',
				label: 'desc'
			}
		],
		default: 'asc'
	},
	{
		path: 'Console/OrderBy',
		type: 'select',
		label: 'Order by',
		options: [
			{
				value: 'exec',
				label: 'exec'
			},
			{
				value: 'time',
				label: 'time'
			},
			{
				value: 'count',
				label: 'count'
			}
		],
		default: 'exec'
	},
	{
		path: 'Console/StartHistory',
		type: 'bool',
		label: 'Show query history at start',
		default: false
	},
	{
		path: 'ConsoleEnterExecutes',
		type: 'bool',
		label: 'Enter executes queries in console',
		help: 'Queries are executed by pressing Enter (instead of Ctrl+Enter). New lines will be inserted with Shift+Enter.',
		default: false
	},
	{
		path: 'DBG/sql',
		type: 'bool',
		label: 'Debug SQL',
		help: 'Log SQL queries and their execution time, to be displayed in the console',
		default: false
	},
	{
		path: 'DefaultConnectionCollation',
		type: 'text',
		label: 'Server connection collation',
		default: 'utf8mb4_unicode_ci'
	},
	{
		path: 'DefaultForeignKeyChecks',
		type: 'select',
		label: 'Foreign key checks',
		options: [
			{
				value: 'default',
				label: 'Server default'
			},
			{
				value: 'enable',
				label: 'Enable'
			},
			{
				value: 'disable',
				label: 'Disable'
			}
		],
		help: 'Default value for foreign key checks checkbox for some queries.',
		default: 'default'
	},
	{
		path: 'DefaultTabDatabase',
		type: 'select',
		label: 'Default database tab',
		options: [
			{
				value: 'structure',
				label: 'Structure'
			},
			{
				value: 'sql',
				label: 'SQL'
			},
			{
				value: 'search',
				label: 'Search'
			},
			{
				value: 'operations',
				label: 'Operations'
			}
		],
		help: 'Tab that is displayed when entering a database.',
		default: 'structure'
	},
	{
		path: 'DefaultTabServer',
		type: 'select',
		label: 'Default server tab',
		options: [
			{
				value: 'welcome',
				label: 'Welcome'
			},
			{
				value: 'databases',
				label: 'Databases'
			},
			{
				value: 'status',
				label: 'Status'
			},
			{
				value: 'variables',
				label: 'Variables'
			},
			{
				value: 'privileges',
				label: 'Privileges'
			}
		],
		help: 'Tab that is displayed when entering a server.',
		default: 'welcome'
	},
	{
		path: 'DefaultTabTable',
		type: 'select',
		label: 'Default table tab',
		options: [
			{
				value: 'structure',
				label: 'Structure'
			},
			{
				value: 'sql',
				label: 'SQL'
			},
			{
				value: 'search',
				label: 'Search'
			},
			{
				value: 'insert',
				label: 'Insert'
			},
			{
				value: 'browse',
				label: 'Browse'
			}
		],
		help: 'Tab that is displayed when entering a table.',
		default: 'browse'
	},
	{
		path: 'DisableMultiTableMaintenance',
		type: 'bool',
		label: 'Disable multi table maintenance',
		help: 'Disable the table maintenance mass operations, like optimizing or repairing the selected tables of a database.',
		default: false
	},
	{
		path: 'DisableShortcutKeys',
		type: 'bool',
		label: 'Disable shortcut keys',
		help: 'Disable shortcut keys',
		default: false
	},
	{
		path: 'DisplayServersList',
		type: 'bool',
		label: 'Display servers as a list',
		help: 'Show server listing as a list instead of a drop down.',
		default: false
	},
	{
		path: 'EnableAutocompleteForTablesAndColumns',
		type: 'bool',
		label: 'Enable autocomplete for table and column names',
		help: 'Autocomplete of the table and column names in the SQL queries.',
		default: true
	},
	{
		path: 'Export/as_separate_files',
		type: 'bool',
		label: 'Export as separate files',
		default: false
	},
	{
		path: 'Export/charset',
		type: 'select',
		label: 'Character set of the file',
		options: [
			{
				value: '',
				label: ''
			},
			{
				value: 'iso-8859-1',
				label: 'iso-8859-1'
			},
			{
				value: 'iso-8859-2',
				label: 'iso-8859-2'
			},
			{
				value: 'iso-8859-3',
				label: 'iso-8859-3'
			},
			{
				value: 'iso-8859-4',
				label: 'iso-8859-4'
			},
			{
				value: 'iso-8859-5',
				label: 'iso-8859-5'
			},
			{
				value: 'iso-8859-6',
				label: 'iso-8859-6'
			},
			{
				value: 'iso-8859-7',
				label: 'iso-8859-7'
			},
			{
				value: 'iso-8859-8',
				label: 'iso-8859-8'
			},
			{
				value: 'iso-8859-9',
				label: 'iso-8859-9'
			},
			{
				value: 'iso-8859-10',
				label: 'iso-8859-10'
			},
			{
				value: 'iso-8859-11',
				label: 'iso-8859-11'
			},
			{
				value: 'iso-8859-12',
				label: 'iso-8859-12'
			},
			{
				value: 'iso-8859-13',
				label: 'iso-8859-13'
			},
			{
				value: 'iso-8859-14',
				label: 'iso-8859-14'
			},
			{
				value: 'iso-8859-15',
				label: 'iso-8859-15'
			},
			{
				value: 'windows-1250',
				label: 'windows-1250'
			},
			{
				value: 'windows-1251',
				label: 'windows-1251'
			},
			{
				value: 'windows-1252',
				label: 'windows-1252'
			},
			{
				value: 'windows-1256',
				label: 'windows-1256'
			},
			{
				value: 'windows-1257',
				label: 'windows-1257'
			},
			{
				value: 'koi8-r',
				label: 'koi8-r'
			},
			{
				value: 'big5',
				label: 'big5'
			},
			{
				value: 'gb2312',
				label: 'gb2312'
			},
			{
				value: 'utf-16',
				label: 'utf-16'
			},
			{
				value: 'utf-8',
				label: 'utf-8'
			},
			{
				value: 'utf-7',
				label: 'utf-7'
			},
			{
				value: 'x-user-defined',
				label: 'x-user-defined'
			},
			{
				value: 'euc-jp',
				label: 'euc-jp'
			},
			{
				value: 'ks_c_5601-1987',
				label: 'ks_c_5601-1987'
			},
			{
				value: 'tis-620',
				label: 'tis-620'
			},
			{
				value: 'SHIFT_JIS',
				label: 'SHIFT_JIS'
			},
			{
				value: 'SJIS',
				label: 'SJIS'
			},
			{
				value: 'SJIS-win',
				label: 'SJIS-win'
			}
		],
		default: ''
	},
	{
		path: 'Export/codegen_format',
		type: 'select',
		label: 'Format',
		options: [
			{
				value: '#',
				label: '#'
			},
			{
				value: 'NHibernate C# DO',
				label: 'NHibernate C# DO'
			},
			{
				value: 'NHibernate XML',
				label: 'NHibernate XML'
			}
		],
		default: '#'
	},
	{
		path: 'Export/compression',
		type: 'select',
		label: 'Compression',
		options: [
			{
				value: 'none',
				label: 'none'
			},
			{
				value: 'zip',
				label: 'zip'
			},
			{
				value: 'gzip',
				label: 'gzip'
			}
		],
		default: 'none'
	},
	{
		path: 'Export/csv_columns',
		type: 'bool',
		label: 'Put columns names in the first row',
		default: true
	},
	{
		path: 'Export/csv_enclosed',
		type: 'text',
		label: 'Columns enclosed with',
		default: '"'
	},
	{
		path: 'Export/csv_escaped',
		type: 'text',
		label: 'Columns escaped with',
		default: '"'
	},
	{
		path: 'Export/csv_null',
		type: 'text',
		label: 'Replace NULL with',
		default: 'NULL'
	},
	{
		path: 'Export/csv_removeCRLF',
		type: 'bool',
		label: 'Remove CRLF characters within columns',
		default: false
	},
	{
		path: 'Export/csv_separator',
		type: 'text',
		label: 'Columns terminated with',
		default: ','
	},
	{
		path: 'Export/csv_terminated',
		type: 'text',
		label: 'Lines terminated with',
		default: 'AUTO'
	},
	{
		path: 'Export/excel_columns',
		type: 'bool',
		label: 'Put columns names in the first row',
		default: true
	},
	{
		path: 'Export/excel_edition',
		type: 'select',
		label: 'Excel edition',
		options: [
			{
				value: 'win',
				label: 'Windows'
			},
			{
				value: 'mac_excel2003',
				label: 'Excel 2003 / Macintosh'
			},
			{
				value: 'mac_excel2008',
				label: 'Excel 2008 / Macintosh'
			}
		],
		default: 'win'
	},
	{
		path: 'Export/excel_null',
		type: 'text',
		label: 'Replace NULL with',
		default: 'NULL'
	},
	{
		path: 'Export/excel_removeCRLF',
		type: 'bool',
		label: 'Remove CRLF characters within columns',
		default: false
	},
	{
		path: 'Export/file_template_database',
		type: 'text',
		label: 'Database name template',
		default: '@DATABASE@'
	},
	{
		path: 'Export/file_template_server',
		type: 'text',
		label: 'Server name template',
		default: '@SERVER@'
	},
	{
		path: 'Export/file_template_table',
		type: 'text',
		label: 'Table name template',
		default: '@TABLE@'
	},
	{
		path: 'Export/format',
		type: 'select',
		label: 'Format',
		options: [
			{
				value: 'codegen',
				label: 'codegen'
			},
			{
				value: 'csv',
				label: 'csv'
			},
			{
				value: 'excel',
				label: 'excel'
			},
			{
				value: 'htmlexcel',
				label: 'htmlexcel'
			},
			{
				value: 'htmlword',
				label: 'htmlword'
			},
			{
				value: 'latex',
				label: 'latex'
			},
			{
				value: 'ods',
				label: 'ods'
			},
			{
				value: 'odt',
				label: 'odt'
			},
			{
				value: 'pdf',
				label: 'pdf'
			},
			{
				value: 'sql',
				label: 'sql'
			},
			{
				value: 'texytext',
				label: 'texytext'
			},
			{
				value: 'xml',
				label: 'xml'
			},
			{
				value: 'yaml',
				label: 'yaml'
			}
		],
		default: 'sql'
	},
	{
		path: 'Export/htmlword_columns',
		type: 'bool',
		label: 'Put columns names in the first row',
		default: false
	},
	{
		path: 'Export/htmlword_null',
		type: 'text',
		label: 'Replace NULL with',
		default: 'NULL'
	},
	{
		path: 'Export/htmlword_structure_or_data',
		type: 'select',
		label: 'Dump table',
		options: [
			{
				value: 'structure',
				label: 'structure'
			},
			{
				value: 'data',
				label: 'data'
			},
			{
				value: 'structure_and_data',
				label: 'structure and data'
			}
		],
		default: 'structure_and_data'
	},
	{
		path: 'Export/latex_caption',
		type: 'bool',
		label: 'Include table caption',
		default: true
	},
	{
		path: 'Export/latex_columns',
		type: 'bool',
		label: 'Put columns names in the first row',
		default: true
	},
	{
		path: 'Export/latex_comments',
		type: 'bool',
		label: 'Comments',
		default: true
	},
	{
		path: 'Export/latex_data_caption',
		type: 'text',
		label: 'Table caption',
		default: 'strLatexContent'
	},
	{
		path: 'Export/latex_data_continued_caption',
		type: 'text',
		label: 'Continued table caption',
		default: 'strLatexContent strLatexContinued'
	},
	{
		path: 'Export/latex_data_label',
		type: 'text',
		label: 'Label key',
		default: 'tab:@TABLE@-data'
	},
	{
		path: 'Export/latex_mime',
		type: 'bool',
		label: 'Media type',
		default: true
	},
	{
		path: 'Export/latex_null',
		type: 'text',
		label: 'Replace NULL with',
		default: '\\textit{NULL}'
	},
	{
		path: 'Export/latex_relation',
		type: 'bool',
		label: 'Relationships',
		default: true
	},
	{
		path: 'Export/latex_structure_caption',
		type: 'text',
		label: 'Table caption',
		default: 'strLatexStructure'
	},
	{
		path: 'Export/latex_structure_continued_caption',
		type: 'text',
		label: 'Continued table caption',
		default: 'strLatexStructure strLatexContinued'
	},
	{
		path: 'Export/latex_structure_label',
		type: 'text',
		label: 'Label key',
		default: 'tab:@TABLE@-structure'
	},
	{
		path: 'Export/latex_structure_or_data',
		type: 'select',
		label: 'Dump table',
		options: [
			{
				value: 'structure',
				label: 'structure'
			},
			{
				value: 'data',
				label: 'data'
			},
			{
				value: 'structure_and_data',
				label: 'structure and data'
			}
		],
		default: 'structure_and_data'
	},
	{
		path: 'Export/lock_tables',
		type: 'bool',
		label: 'Use LOCK TABLES statement',
		default: false
	},
	{
		path: 'Export/method',
		type: 'select',
		label: 'Export method',
		options: [
			{
				value: 'quick',
				label: 'Quick - display only the minimal options to configure'
			},
			{
				value: 'custom',
				label: 'Custom - display all possible options to configure'
			},
			{
				value: 'custom-no-form',
				label: 'Custom - like above, but without the quick/custom choice'
			}
		],
		default: 'quick'
	},
	{
		path: 'Export/ods_columns',
		type: 'bool',
		label: 'Put columns names in the first row',
		default: false
	},
	{
		path: 'Export/ods_null',
		type: 'text',
		label: 'Replace NULL with',
		default: 'NULL'
	},
	{
		path: 'Export/odt_columns',
		type: 'bool',
		label: 'Put columns names in the first row',
		default: true
	},
	{
		path: 'Export/odt_comments',
		type: 'bool',
		label: 'Comments',
		default: true
	},
	{
		path: 'Export/odt_mime',
		type: 'bool',
		label: 'Media type',
		default: true
	},
	{
		path: 'Export/odt_null',
		type: 'text',
		label: 'Replace NULL with',
		default: 'NULL'
	},
	{
		path: 'Export/odt_relation',
		type: 'bool',
		label: 'Relationships',
		default: true
	},
	{
		path: 'Export/odt_structure_or_data',
		type: 'select',
		label: 'Dump table',
		options: [
			{
				value: 'structure',
				label: 'structure'
			},
			{
				value: 'data',
				label: 'data'
			},
			{
				value: 'structure_and_data',
				label: 'structure and data'
			}
		],
		default: 'structure_and_data'
	},
	{
		path: 'Export/onserver',
		type: 'bool',
		label: 'Save on server',
		default: false
	},
	{
		path: 'Export/onserver_overwrite',
		type: 'bool',
		label: 'Overwrite existing file(s)',
		default: false
	},
	{
		path: 'Export/quick_export_onserver',
		type: 'bool',
		label: 'Save on server',
		default: false
	},
	{
		path: 'Export/quick_export_onserver_overwrite',
		type: 'bool',
		label: 'Overwrite existing file(s)',
		default: false
	},
	{
		path: 'Export/sql_auto_increment',
		type: 'bool',
		label: 'Add AUTO_INCREMENT value',
		default: true
	},
	{
		path: 'Export/sql_backquotes',
		type: 'bool',
		label: 'Enclose table and column names with backquotes',
		default: true
	},
	{
		path: 'Export/sql_compatibility',
		type: 'select',
		label: 'SQL compatibility mode',
		options: [
			{
				value: 'NONE',
				label: 'NONE'
			},
			{
				value: 'ANSI',
				label: 'ANSI'
			},
			{
				value: 'DB2',
				label: 'DB2'
			},
			{
				value: 'MAXDB',
				label: 'MAXDB'
			},
			{
				value: 'MYSQL323',
				label: 'MYSQL323'
			},
			{
				value: 'MYSQL40',
				label: 'MYSQL40'
			},
			{
				value: 'MSSQL',
				label: 'MSSQL'
			},
			{
				value: 'ORACLE',
				label: 'ORACLE'
			},
			{
				value: 'TRADITIONAL',
				label: 'TRADITIONAL'
			}
		],
		default: 'NONE'
	},
	{
		path: 'Export/sql_create_database',
		type: 'bool',
		label: 'Add CREATE DATABASE / USE',
		default: false
	},
	{
		path: 'Export/sql_create_trigger',
		type: 'bool',
		label: 'Add CREATE TRIGGER',
		default: true
	},
	{
		path: 'Export/sql_dates',
		type: 'bool',
		label: 'Creation/Update/Check dates',
		default: false
	},
	{
		path: 'Export/sql_delayed',
		type: 'bool',
		label: 'Use delayed inserts',
		default: false
	},
	{
		path: 'Export/sql_disable_fk',
		type: 'bool',
		label: 'Disable foreign key checks',
		default: false
	},
	{
		path: 'Export/sql_drop_database',
		type: 'bool',
		label: 'Add DROP DATABASE',
		default: false
	},
	{
		path: 'Export/sql_drop_table',
		type: 'bool',
		label: 'Add DROP TABLE / VIEW / PROCEDURE / FUNCTION / EVENT / TRIGGER',
		default: false
	},
	{
		path: 'Export/sql_hex_for_binary',
		type: 'bool',
		label: 'Use hexadecimal for BINARY & BLOB',
		default: true
	},
	{
		path: 'Export/sql_if_not_exists',
		type: 'bool',
		label: 'Add IF NOT EXISTS (less efficient as indexes will be generated during table creation)',
		default: false
	},
	{
		path: 'Export/sql_ignore',
		type: 'bool',
		label: 'Use ignore inserts',
		default: false
	},
	{
		path: 'Export/sql_insert_syntax',
		type: 'select',
		label: 'Syntax to use when inserting data',
		options: [
			{
				value: 'complete',
				label: 'complete inserts'
			},
			{
				value: 'extended',
				label: 'extended inserts'
			},
			{
				value: 'both',
				label: 'both of the above'
			},
			{
				value: 'none',
				label: 'neither of the above'
			}
		],
		default: 'both'
	},
	{
		path: 'Export/sql_max_query_size',
		type: 'number',
		label: 'Maximal length of created query',
		default: 50000,
		min: 1
	},
	{
		path: 'Export/sql_metadata',
		type: 'bool',
		label: 'Export related metadata from phpMyAdmin configuration storage',
		default: false
	},
	{
		path: 'Export/sql_mime',
		type: 'bool',
		label: 'Media type',
		default: false
	},
	{
		path: 'Export/sql_or_replace_view',
		type: 'bool',
		label: 'OR REPLACE view',
		default: false
	},
	{
		path: 'Export/sql_procedure_function',
		type: 'bool',
		label: 'Add CREATE PROCEDURE / FUNCTION / EVENT',
		default: true
	},
	{
		path: 'Export/sql_relation',
		type: 'bool',
		label: 'Relationships',
		default: false
	},
	{
		path: 'Export/sql_structure_or_data',
		type: 'select',
		label: 'Dump table',
		options: [
			{
				value: 'structure',
				label: 'structure'
			},
			{
				value: 'data',
				label: 'data'
			},
			{
				value: 'structure_and_data',
				label: 'structure and data'
			}
		],
		default: 'structure_and_data'
	},
	{
		path: 'Export/sql_type',
		type: 'select',
		label: 'Export type',
		options: [
			{
				value: 'INSERT',
				label: 'INSERT'
			},
			{
				value: 'UPDATE',
				label: 'UPDATE'
			},
			{
				value: 'REPLACE',
				label: 'REPLACE'
			}
		],
		default: 'INSERT'
	},
	{
		path: 'Export/sql_use_transaction',
		type: 'bool',
		label: 'Enclose export in a transaction',
		default: true
	},
	{
		path: 'Export/sql_utc_time',
		type: 'bool',
		label: 'Export time in UTC',
		default: true
	},
	{
		path: 'Export/sql_view_current_user',
		type: 'bool',
		label: 'Exclude definition of current user',
		default: false
	},
	{
		path: 'Export/sql_views_as_tables',
		type: 'bool',
		label: 'Export views as tables',
		default: false
	},
	{
		path: 'Export/texytext_columns',
		type: 'bool',
		label: 'Put columns names in the first row',
		default: false
	},
	{
		path: 'Export/texytext_null',
		type: 'text',
		label: 'Replace NULL with',
		default: 'NULL'
	},
	{
		path: 'Export/texytext_structure_or_data',
		type: 'select',
		label: 'Dump table',
		options: [
			{
				value: 'structure',
				label: 'structure'
			},
			{
				value: 'data',
				label: 'data'
			},
			{
				value: 'structure_and_data',
				label: 'structure and data'
			}
		],
		default: 'structure_and_data'
	},
	{
		path: 'FirstDayOfCalendar',
		type: 'select',
		label: 'First day of calendar',
		options: [
			{
				value: 0,
				label: 'Default'
			},
			{
				value: 1,
				label: 'Monday'
			},
			{
				value: 2,
				label: 'Tuesday'
			},
			{
				value: 3,
				label: 'Wednesday'
			},
			{
				value: 4,
				label: 'Thursday'
			},
			{
				value: 5,
				label: 'Friday'
			},
			{
				value: 6,
				label: 'Saturday'
			},
			{
				value: 7,
				label: 'Sunday'
			}
		],
		default: 0
	},
	{
		path: 'FirstLevelNavigationItems',
		type: 'number',
		label: 'Maximum items on first level',
		help: 'The number of items that can be displayed on each page on the first level of the navigation tree.',
		default: 100,
		min: 1
	},
	{
		path: 'ForeignKeyDropdownOrder',
		type: 'list',
		label: 'Foreign key dropdown order',
		help: 'Sort order for items in a foreign-key dropdown box; content is the referenced data, id is the key value.',
		default: ['content-id', 'id-content']
	},
	{
		path: 'ForeignKeyMaxLimit',
		type: 'number',
		label: 'Foreign key limit',
		help: 'A dropdown will be used if fewer items are present.',
		default: 100,
		min: 1
	},
	{
		path: 'GridEditing',
		type: 'select',
		label: 'Grid editing: trigger action',
		options: [
			{
				value: 'click',
				label: 'Click'
			},
			{
				value: 'double-click',
				label: 'Double click'
			},
			{
				value: 'disabled',
				label: 'Disabled'
			}
		],
		default: 'double-click'
	},
	{
		path: 'HideStructureActions',
		type: 'bool',
		label: 'Hide table structure actions',
		help: 'Whether the table structure actions should be hidden.',
		default: true
	},
	{
		path: 'IgnoreMultiSubmitErrors',
		type: 'bool',
		label: 'Ignore multiple statement errors',
		help: 'If enabled, phpMyAdmin continues computing multiple-statement queries even if one of the queries failed.',
		default: false
	},
	{
		path: 'Import/allow_interrupt',
		type: 'bool',
		label: 'Partial import: allow interrupt',
		help: 'Allow interrupt of import in case script detects it is close to time limit. This might be a good way to import large files, however it can break transactions.',
		default: true
	},
	{
		path: 'Import/charset',
		type: 'select',
		label: 'Character set of the file',
		options: [
			{
				value: '',
				label: ''
			},
			{
				value: 'iso-8859-1',
				label: 'iso-8859-1'
			},
			{
				value: 'iso-8859-2',
				label: 'iso-8859-2'
			},
			{
				value: 'iso-8859-3',
				label: 'iso-8859-3'
			},
			{
				value: 'iso-8859-4',
				label: 'iso-8859-4'
			},
			{
				value: 'iso-8859-5',
				label: 'iso-8859-5'
			},
			{
				value: 'iso-8859-6',
				label: 'iso-8859-6'
			},
			{
				value: 'iso-8859-7',
				label: 'iso-8859-7'
			},
			{
				value: 'iso-8859-8',
				label: 'iso-8859-8'
			},
			{
				value: 'iso-8859-9',
				label: 'iso-8859-9'
			},
			{
				value: 'iso-8859-10',
				label: 'iso-8859-10'
			},
			{
				value: 'iso-8859-11',
				label: 'iso-8859-11'
			},
			{
				value: 'iso-8859-12',
				label: 'iso-8859-12'
			},
			{
				value: 'iso-8859-13',
				label: 'iso-8859-13'
			},
			{
				value: 'iso-8859-14',
				label: 'iso-8859-14'
			},
			{
				value: 'iso-8859-15',
				label: 'iso-8859-15'
			},
			{
				value: 'windows-1250',
				label: 'windows-1250'
			},
			{
				value: 'windows-1251',
				label: 'windows-1251'
			},
			{
				value: 'windows-1252',
				label: 'windows-1252'
			},
			{
				value: 'windows-1256',
				label: 'windows-1256'
			},
			{
				value: 'windows-1257',
				label: 'windows-1257'
			},
			{
				value: 'koi8-r',
				label: 'koi8-r'
			},
			{
				value: 'big5',
				label: 'big5'
			},
			{
				value: 'gb2312',
				label: 'gb2312'
			},
			{
				value: 'utf-16',
				label: 'utf-16'
			},
			{
				value: 'utf-8',
				label: 'utf-8'
			},
			{
				value: 'utf-7',
				label: 'utf-7'
			},
			{
				value: 'x-user-defined',
				label: 'x-user-defined'
			},
			{
				value: 'euc-jp',
				label: 'euc-jp'
			},
			{
				value: 'ks_c_5601-1987',
				label: 'ks_c_5601-1987'
			},
			{
				value: 'tis-620',
				label: 'tis-620'
			},
			{
				value: 'SHIFT_JIS',
				label: 'SHIFT_JIS'
			},
			{
				value: 'SJIS',
				label: 'SJIS'
			},
			{
				value: 'SJIS-win',
				label: 'SJIS-win'
			}
		],
		default: ''
	},
	{
		path: 'Import/csv_col_names',
		type: 'bool',
		label: 'The first line of the file contains the table column names',
		default: false
	},
	{
		path: 'Import/csv_enclosed',
		type: 'text',
		label: 'Columns enclosed with',
		default: '"'
	},
	{
		path: 'Import/csv_escaped',
		type: 'text',
		label: 'Columns escaped with',
		default: '"'
	},
	{
		path: 'Import/csv_ignore',
		type: 'bool',
		label: 'Do not abort on INSERT error',
		default: false
	},
	{
		path: 'Import/csv_replace',
		type: 'bool',
		label: 'Add ON DUPLICATE KEY UPDATE',
		help: 'Update data when duplicate keys found on import',
		default: false
	},
	{
		path: 'Import/csv_terminated',
		type: 'text',
		label: 'Columns terminated with',
		default: ','
	},
	{
		path: 'Import/format',
		type: 'select',
		label: 'Format of imported file',
		options: [
			{
				value: 'csv',
				label: 'csv'
			},
			{
				value: 'docsql',
				label: 'docsql'
			},
			{
				value: 'ldi',
				label: 'ldi'
			},
			{
				value: 'sql',
				label: 'sql'
			}
		],
		help: 'Default format; be aware that this list depends on location (database, table) and only SQL is always available.',
		default: 'sql'
	},
	{
		path: 'Import/ldi_enclosed',
		type: 'text',
		label: 'Columns enclosed with',
		default: '"'
	},
	{
		path: 'Import/ldi_escaped',
		type: 'text',
		label: 'Columns escaped with',
		default: '\\'
	},
	{
		path: 'Import/ldi_ignore',
		type: 'bool',
		label: 'Do not abort on INSERT error',
		default: false
	},
	{
		path: 'Import/ldi_local_option',
		type: 'select',
		label: 'Use LOCAL keyword',
		options: [
			{
				value: 'auto',
				label: 'auto'
			},
			{
				value: true,
				label: 'Yes'
			},
			{
				value: false,
				label: 'No'
			}
		],
		default: 'auto'
	},
	{
		path: 'Import/ldi_replace',
		type: 'bool',
		label: 'Add ON DUPLICATE KEY UPDATE',
		help: 'Update data when duplicate keys found on import',
		default: false
	},
	{
		path: 'Import/ldi_terminated',
		type: 'text',
		label: 'Columns terminated with',
		default: ';'
	},
	{
		path: 'Import/ods_col_names',
		type: 'bool',
		label: 'Column names in first row',
		default: false
	},
	{
		path: 'Import/ods_empty_rows',
		type: 'bool',
		label: 'Do not import empty rows',
		default: true
	},
	{
		path: 'Import/ods_recognize_currency',
		type: 'bool',
		label: 'Import currencies ($5.00 to 5.00)',
		default: true
	},
	{
		path: 'Import/ods_recognize_percentages',
		type: 'bool',
		label: 'Import percentages as proper decimals (12.00% to .12)',
		default: true
	},
	{
		path: 'Import/skip_queries',
		type: 'number',
		label: 'Partial import: skip queries',
		help: 'Number of queries to skip from start.',
		default: 0,
		min: 0
	},
	{
		path: 'Import/sql_compatibility',
		type: 'select',
		label: 'SQL compatibility mode',
		options: [
			{
				value: 'NONE',
				label: 'NONE'
			},
			{
				value: 'ANSI',
				label: 'ANSI'
			},
			{
				value: 'DB2',
				label: 'DB2'
			},
			{
				value: 'MAXDB',
				label: 'MAXDB'
			},
			{
				value: 'MYSQL323',
				label: 'MYSQL323'
			},
			{
				value: 'MYSQL40',
				label: 'MYSQL40'
			},
			{
				value: 'MSSQL',
				label: 'MSSQL'
			},
			{
				value: 'ORACLE',
				label: 'ORACLE'
			},
			{
				value: 'TRADITIONAL',
				label: 'TRADITIONAL'
			}
		],
		default: 'NONE'
	},
	{
		path: 'Import/sql_no_auto_value_on_zero',
		type: 'bool',
		label: 'Do not use AUTO_INCREMENT for zero values',
		default: true
	},
	{
		path: 'Import/sql_read_as_multibytes',
		type: 'bool',
		label: 'Read as multibytes',
		default: false
	},
	{
		path: 'InitialSlidersState',
		type: 'select',
		label: 'Initial state for sliders',
		options: [
			{
				value: 'open',
				label: 'Open'
			},
			{
				value: 'closed',
				label: 'Closed'
			},
			{
				value: 'disabled',
				label: 'Disabled'
			}
		],
		default: 'closed'
	},
	{
		path: 'InsertRows',
		type: 'number',
		label: 'Number of inserted rows',
		help: 'How many rows can be inserted at one time.',
		default: 2,
		min: 1
	},
	{
		path: 'LimitChars',
		type: 'number',
		label: 'Limit column characters',
		help: 'Maximum number of characters shown in any non-numeric column on browse view.',
		default: 50,
		min: 1
	},
	{
		path: 'LintEnable',
		type: 'bool',
		label: 'Enable linter',
		help: 'Find any errors in the query before executing it. Requires CodeMirror to be enabled.',
		default: true
	},
	{
		path: 'LoginCookieValidityDisableWarning',
		type: 'bool',
		label: 'Login cookie validity warning',
		help: 'Disable the default warning that is displayed on the main page if the value of the PHP setting session.gc_maxlifetime is less than the value of `LoginCookieValidity`.',
		default: false
	},
	{
		path: 'LongtextDoubleTextarea',
		type: 'bool',
		label: 'Bigger textarea for LONGTEXT',
		help: 'Double size of textarea for LONGTEXT columns.',
		default: true
	},
	{
		path: 'MaxCharactersInDisplayedSQL',
		type: 'number',
		label: 'Maximum displayed SQL length',
		help: 'Maximum number of characters used when a SQL query is displayed.',
		default: 1000,
		min: 1
	},
	{
		path: 'MaxDbList',
		type: 'number',
		label: 'Maximum databases',
		help: 'Maximum number of databases displayed in database list.',
		comment: 'Users cannot set a higher value',
		default: 100,
		min: 1
	},
	{
		path: 'MaxNavigationItems',
		type: 'number',
		label: 'Maximum items in branch',
		help: 'The number of items that can be displayed on each page of the navigation tree.',
		default: 50,
		min: 1
	},
	{
		path: 'MaxRows',
		type: 'number',
		label: 'Maximum number of rows to display',
		help: 'Number of rows displayed when browsing a result set. If the result set contains more rows, "Previous" and "Next" links will be shown.',
		default: 25,
		min: 1
	},
	{
		path: 'MaxSizeForInputField',
		type: 'number',
		label: 'Maximum size for input field',
		help: 'Defines the maximum size for input fields generated for CHAR and VARCHAR columns.',
		default: 60,
		min: 1
	},
	{
		path: 'MaxTableList',
		type: 'number',
		label: 'Maximum tables',
		help: 'Maximum number of tables displayed in table list.',
		comment: 'Users cannot set a higher value',
		default: 250,
		min: 1
	},
	{
		path: 'MinSizeForInputField',
		type: 'number',
		label: 'Minimum size for input field',
		help: 'Defines the minimum size for input fields generated for CHAR and VARCHAR columns.',
		default: 4,
		min: 0
	},
	{
		path: 'NaturalOrder',
		type: 'bool',
		label: 'Natural order',
		help: 'Use natural order for sorting table and database names.',
		default: true
	},
	{
		path: 'NavigationDisplayLogo',
		type: 'bool',
		label: 'Display logo',
		help: 'Show logo in navigation panel.',
		default: true
	},
	{
		path: 'NavigationDisplayServers',
		type: 'bool',
		label: 'Display servers selection',
		help: 'Display server choice at the top of the navigation panel.',
		default: true
	},
	{
		path: 'NavigationLinkWithMainPanel',
		type: 'bool',
		label: 'Link with main panel',
		help: 'Link with main panel by highlighting the current database or table.',
		default: true
	},
	{
		path: 'NavigationLogoLink',
		type: 'text',
		label: 'Logo link URL',
		help: 'URL where logo in the navigation panel will point to.',
		default: 'index.php'
	},
	{
		path: 'NavigationLogoLinkWindow',
		type: 'select',
		label: 'Logo link target',
		options: [
			{
				value: 'main',
				label: 'main'
			},
			{
				value: 'new',
				label: 'new'
			}
		],
		help: 'Open the linked page in the main window (main) or in a new one (new).',
		default: 'main'
	},
	{
		path: 'NavigationTreeAutoexpandSingleDb',
		type: 'bool',
		label: 'Expand single database',
		help: 'Whether to expand single database in the navigation tree automatically.',
		default: true
	},
	{
		path: 'NavigationTreeDbSeparator',
		type: 'text',
		label: 'Database tree separator',
		help: 'String that separates databases into different tree levels.',
		default: '_'
	},
	{
		path: 'NavigationTreeDefaultTabTable',
		type: 'select',
		label: 'Target for quick access icon',
		options: [
			{
				value: 'structure',
				label: 'Structure'
			},
			{
				value: 'sql',
				label: 'SQL'
			},
			{
				value: 'search',
				label: 'Search'
			},
			{
				value: 'insert',
				label: 'Insert'
			},
			{
				value: 'browse',
				label: 'Browse'
			}
		],
		default: 'structure'
	},
	{
		path: 'NavigationTreeDefaultTabTable2',
		type: 'select',
		label: 'Target for second quick access icon',
		options: [
			{
				value: '',
				label: ''
			},
			{
				value: 'structure',
				label: 'Structure'
			},
			{
				value: 'sql',
				label: 'SQL'
			},
			{
				value: 'search',
				label: 'Search'
			},
			{
				value: 'insert',
				label: 'Insert'
			},
			{
				value: 'browse',
				label: 'Browse'
			}
		],
		default: ''
	},
	{
		path: 'NavigationTreeDisplayDbFilterMinimum',
		type: 'number',
		label: 'Minimum number of databases to display the database filter box',
		default: 30,
		min: 0
	},
	{
		path: 'NavigationTreeDisplayItemFilterMinimum',
		type: 'number',
		label: 'Minimum number of items to display the filter box',
		help: 'Defines the minimum number of items (tables, views, routines and events) to display a filter box.',
		default: 30,
		min: 1
	},
	{
		path: 'NavigationTreeEnableExpansion',
		type: 'bool',
		label: 'Enable navigation tree expansion',
		help: 'Whether to offer the possibility of tree expansion in the navigation panel.',
		default: true
	},
	{
		path: 'NavigationTreeEnableGrouping',
		type: 'bool',
		label: 'Group items in the tree',
		help: 'Group items in the navigation tree (determined by the separator defined in the Databases and Tables tabs above).',
		default: true
	},
	{
		path: 'NavigationTreePointerEnable',
		type: 'bool',
		label: 'Enable highlighting',
		help: 'Highlight server under the mouse cursor.',
		default: true
	},
	{
		path: 'NavigationTreeShowEvents',
		type: 'bool',
		label: 'Show events in tree',
		help: 'Whether to show events under database in the navigation tree',
		default: true
	},
	{
		path: 'NavigationTreeShowFunctions',
		type: 'bool',
		label: 'Show functions in tree',
		help: 'Whether to show functions under database in the navigation tree',
		default: true
	},
	{
		path: 'NavigationTreeShowProcedures',
		type: 'bool',
		label: 'Show procedures in tree',
		help: 'Whether to show procedures under database in the navigation tree',
		default: true
	},
	{
		path: 'NavigationTreeShowTables',
		type: 'bool',
		label: 'Show tables in tree',
		help: 'Whether to show tables under database in the navigation tree',
		default: true
	},
	{
		path: 'NavigationTreeShowViews',
		type: 'bool',
		label: 'Show views in tree',
		help: 'Whether to show views under database in the navigation tree',
		default: true
	},
	{
		path: 'NavigationTreeTableLevel',
		type: 'number',
		label: 'Maximum table tree depth',
		default: 1,
		min: 1
	},
	{
		path: 'NavigationTreeTableSeparator',
		type: 'text',
		label: 'Table tree separator',
		help: 'String that separates tables into different tree levels.',
		default: '__'
	},
	{
		path: 'NavigationWidth',
		type: 'number',
		label: 'Navigation panel width',
		help: 'Set to 0 to collapse navigation panel.',
		default: 240,
		min: 0
	},
	{
		path: 'NumFavoriteTables',
		type: 'number',
		label: 'Favorite tables',
		help: 'Maximum number of favorite tables; set 0 to disable.',
		default: 10,
		min: 0
	},
	{
		path: 'NumRecentTables',
		type: 'number',
		label: 'Recently used tables',
		help: 'Maximum number of recently used tables; set 0 to disable.',
		default: 10,
		min: 0
	},
	{
		path: 'Order',
		type: 'select',
		label: 'Default sorting order',
		options: [
			{
				value: 'ASC',
				label: 'ASC'
			},
			{
				value: 'DESC',
				label: 'DESC'
			},
			{
				value: 'SMART',
				label: 'SMART'
			}
		],
		help: 'SMART - i.e. descending order for columns of type TIME, DATE, DATETIME and TIMESTAMP, ascending order otherwise.',
		default: 'SMART'
	},
	{
		path: 'PDFDefaultPageSize',
		type: 'select',
		label: 'Paper size',
		options: [
			{
				value: 'A3',
				label: 'A3'
			},
			{
				value: 'A4',
				label: 'A4'
			},
			{
				value: 'A5',
				label: 'A5'
			},
			{
				value: 'letter',
				label: 'letter'
			},
			{
				value: 'legal',
				label: 'legal'
			}
		],
		default: 'A4'
	},
	{
		path: 'PmaNoRelation_DisableWarning',
		type: 'bool',
		label: 'Missing phpMyAdmin configuration storage tables',
		help: 'Disable the default warning that is displayed on the database details Structure page if any of the required tables for the phpMyAdmin configuration storage could not be found.',
		default: false
	},
	{
		path: 'ProtectBinary',
		type: 'select',
		label: 'Protect binary columns',
		options: [
			{
				value: false,
				label: 'Off'
			},
			{
				value: 'blob',
				label: 'blob'
			},
			{
				value: 'noblob',
				label: 'noblob'
			},
			{
				value: 'all',
				label: 'all'
			}
		],
		help: 'Disallow BLOB and BINARY columns from editing.',
		default: 'blob'
	},
	{
		path: 'QueryHistoryMax',
		type: 'number',
		label: 'Query history length',
		help: 'How many queries are kept in history.',
		comment: 'Users cannot set a higher value',
		default: 25,
		min: 1
	},
	{
		path: 'RelationalDisplay',
		type: 'select',
		label: 'Relational display',
		options: [
			{
				value: 'K',
				label: 'key'
			},
			{
				value: 'D',
				label: 'display column'
			}
		],
		help: 'For display Options',
		default: 'K'
	},
	{
		path: 'RememberSorting',
		type: 'bool',
		label: "Remember table's sorting",
		help: 'When browsing tables, the sorting of each table is remembered.',
		default: true
	},
	{
		path: 'RepeatCells',
		type: 'number',
		label: 'Repeat headers',
		help: 'Repeat the headers every X cells, 0 deactivates this feature.',
		default: 100,
		min: 0
	},
	{
		path: 'ReservedWordDisableWarning',
		type: 'bool',
		label: 'MySQL reserved word warning',
		help: 'Disable the default warning that is displayed on the Structure page if column names in a table are reserved MySQL words.',
		default: false
	},
	{
		path: 'RetainQueryBox',
		type: 'bool',
		label: 'Retain query box',
		help: 'Defines whether the query box should stay on-screen after its submission.',
		default: false
	},
	{
		path: 'RowActionLinks',
		type: 'select',
		label: 'Where to show the table row links',
		options: [
			{
				value: 'none',
				label: 'Nowhere'
			},
			{
				value: 'left',
				label: 'Left'
			},
			{
				value: 'right',
				label: 'Right'
			},
			{
				value: 'both',
				label: 'Both'
			}
		],
		help: 'These are Edit, Copy and Delete links.',
		default: 'left'
	},
	{
		path: 'RowActionLinksWithoutUnique',
		type: 'bool',
		label: 'Show row links anyway',
		help: 'Whether to show row links even in the absence of a unique key.',
		default: false
	},
	{
		path: 'SQLQuery/Edit',
		type: 'bool',
		label: 'Edit',
		default: true
	},
	{
		path: 'SQLQuery/Explain',
		type: 'bool',
		label: 'Explain SQL',
		default: true
	},
	{
		path: 'SQLQuery/Refresh',
		type: 'bool',
		label: 'Refresh',
		default: true
	},
	{
		path: 'SQLQuery/ShowAsPHP',
		type: 'bool',
		label: 'Create PHP code',
		default: true
	},
	{
		path: 'SaveCellsAtOnce',
		type: 'bool',
		label: 'Grid editing: save all edited cells at once',
		default: false
	},
	{
		path: 'SendErrorReports',
		type: 'select',
		label: 'Send error reports',
		options: [
			{
				value: 'ask',
				label: 'Ask before sending error reports'
			},
			{
				value: 'always',
				label: 'Always send error reports'
			},
			{
				value: 'never',
				label: 'Never send error reports'
			}
		],
		help: 'Choose the default action when sending error reports.',
		default: 'ask'
	},
	{
		path: 'Server/hide_db',
		type: 'text',
		label: 'Hide databases',
		help: 'Hide databases matching regular expression (PCRE).',
		default: ''
	},
	{
		path: 'Server/only_db',
		type: 'text',
		label: 'Show only listed databases',
		help: "You can use MySQL wildcard characters (% and _), escape them if you want to use their literal instances, i.e. use 'my\\_db' and not 'my_db'.",
		default: ''
	},
	{
		path: 'ShowAll',
		type: 'bool',
		label: 'Allow to display all the rows',
		help: 'Whether a user should be displayed a "show all (rows)" button.',
		default: false
	},
	{
		path: 'ShowColumnComments',
		type: 'bool',
		label: 'Show column comments',
		help: 'Whether column comments should be shown in table structure view',
		default: true
	},
	{
		path: 'ShowCreateDb',
		type: 'bool',
		label: 'Show create database form',
		default: true
	},
	{
		path: 'ShowDatabasesNavigationAsTree',
		type: 'bool',
		label: 'Show databases navigation as tree',
		help: 'In the navigation panel, replaces the database tree with a selector',
		default: true
	},
	{
		path: 'ShowDbStructureCharset',
		type: 'bool',
		label: 'Show table charset',
		help: 'Show or hide a column displaying the charset for all tables.',
		default: false
	},
	{
		path: 'ShowDbStructureComment',
		type: 'bool',
		label: 'Show table comments',
		help: 'Show or hide a column displaying the comments for all tables.',
		default: false
	},
	{
		path: 'ShowDbStructureCreation',
		type: 'bool',
		label: 'Show creation timestamp',
		help: 'Show or hide a column displaying the Creation timestamp for all tables.',
		default: false
	},
	{
		path: 'ShowDbStructureLastCheck',
		type: 'bool',
		label: 'Show last check timestamp',
		help: 'Show or hide a column displaying the Last check timestamp for all tables.',
		default: false
	},
	{
		path: 'ShowDbStructureLastUpdate',
		type: 'bool',
		label: 'Show last update timestamp',
		help: 'Show or hide a column displaying the Last update timestamp for all tables.',
		default: false
	},
	{
		path: 'ShowFieldTypesInDataEditView',
		type: 'bool',
		label: 'Show field types',
		help: 'Defines whether or not type fields should be initially displayed in edit/insert mode.',
		default: true
	},
	{
		path: 'ShowFunctionFields',
		type: 'bool',
		label: 'Show function fields',
		help: 'Display the function fields in edit/insert mode.',
		default: true
	},
	{
		path: 'ShowHint',
		type: 'bool',
		label: 'Show hint',
		help: 'Whether to show hint or not.',
		default: true
	},
	{
		path: 'ShowSQL',
		type: 'bool',
		label: 'Show SQL queries',
		help: 'Defines whether SQL queries generated by phpMyAdmin should be displayed.',
		default: true
	},
	{
		path: 'ShowServerInfo',
		type: 'bool',
		label: 'Show detailed MySQL server information',
		default: true
	},
	{
		path: 'ShowStats',
		type: 'bool',
		label: 'Show statistics',
		help: 'Allow to display database and table statistics (e.g. space usage).',
		default: true
	},
	{
		path: 'SkipLockedTables',
		type: 'bool',
		label: 'Skip locked tables',
		help: 'Mark used tables and make it possible to show databases with locked tables.',
		default: false
	},
	{
		path: 'SuhosinDisableWarning',
		type: 'bool',
		label: 'Suhosin warning',
		help: 'Disable the default warning that is displayed on the main page if Suhosin is detected.',
		default: false
	},
	{
		path: 'TableNavigationLinksMode',
		type: 'select',
		label: 'Table navigation bar',
		options: [
			{
				value: 'icons',
				label: 'Icons'
			},
			{
				value: 'text',
				label: 'Text'
			},
			{
				value: 'both',
				label: 'Both'
			}
		],
		help: 'Use only icons, only text or both.',
		default: 'icons'
	},
	{
		path: 'TablePrimaryKeyOrder',
		type: 'select',
		label: 'Primary key default sort order',
		options: [
			{
				value: 'NONE',
				label: 'None'
			},
			{
				value: 'ASC',
				label: 'Ascending'
			},
			{
				value: 'DESC',
				label: 'Descending'
			}
		],
		help: 'Default sort order for tables with a primary key.',
		default: 'NONE'
	},
	{
		path: 'TabsMode',
		type: 'select',
		label: 'How to display the menu tabs',
		options: [
			{
				value: 'icons',
				label: 'Icons'
			},
			{
				value: 'text',
				label: 'Text'
			},
			{
				value: 'both',
				label: 'Both'
			}
		],
		help: 'Use only icons, only text or both.',
		default: 'both'
	},
	{
		path: 'TextareaCols',
		type: 'number',
		label: 'Textarea columns',
		help: 'Textarea size (columns) in edit mode, this value will be emphasized for SQL query textareas (*2).',
		default: 40,
		min: 1
	},
	{
		path: 'TextareaRows',
		type: 'number',
		label: 'Textarea rows',
		help: 'Textarea size (rows) in edit mode, this value will be emphasized for SQL query textareas (*2).',
		default: 15,
		min: 1
	},
	{
		path: 'TitleDatabase',
		type: 'text',
		label: 'Database',
		help: 'Title of browser window when a database is selected.',
		default: '@HTTP_HOST@ / @VSERVER@ / @DATABASE@ | @PHPMYADMIN@'
	},
	{
		path: 'TitleDefault',
		type: 'text',
		label: 'Default title',
		help: 'Title of browser window when nothing is selected.',
		default: '@HTTP_HOST@ | @PHPMYADMIN@'
	},
	{
		path: 'TitleServer',
		type: 'text',
		label: 'Server',
		help: 'Title of browser window when a server is selected.',
		default: '@HTTP_HOST@ / @VSERVER@ | @PHPMYADMIN@'
	},
	{
		path: 'TitleTable',
		type: 'text',
		label: 'Table',
		help: 'Title of browser window when a table is selected.',
		default: '@HTTP_HOST@ / @VSERVER@ / @DATABASE@ / @TABLE@ | @PHPMYADMIN@'
	},
	{
		path: 'VersionCheck',
		type: 'bool',
		label: 'Version check',
		help: 'Enables check for latest version on main phpMyAdmin page.',
		default: true
	},
	{
		path: 'enable_drag_drop_import',
		type: 'bool',
		label: 'Enable drag and drop import',
		help: 'Uncheck the checkbox to disable drag and drop import',
		default: true
	}
];
