import { N_ } from '#lib/i18n/index.ts';
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
	{ path: 'Export/asfile', type: 'bool', label: N_('Save as file'), default: true },
	{ path: 'Export/sql_include_comments', type: 'bool', label: N_('Comments'), default: true },
	{ path: 'Export/sql_create_table', type: 'bool', label: N_('Add CREATE TABLE'), default: true },
	{ path: 'Export/sql_create_view', type: 'bool', label: N_('Add CREATE VIEW'), default: true },
	{
		path: 'ActionLinksMode',
		type: 'select',
		label: N_('How to display various action links'),
		options: [
			{
				value: 'icons',
				label: N_('Icons')
			},
			{
				value: 'text',
				label: N_('Text')
			},
			{
				value: 'both',
				label: N_('Both')
			}
		],
		help: N_('Use only icons, only text or both.'),
		default: 'both'
	},
	{
		path: 'BrowseMarkerEnable',
		type: 'bool',
		label: N_('Row marker'),
		help: N_('Highlight selected rows.'),
		default: true
	},
	{
		path: 'BrowsePointerEnable',
		type: 'bool',
		label: N_('Highlight pointer'),
		help: N_('Highlight row pointed by the mouse cursor.'),
		default: true
	},
	{
		path: 'CharEditing',
		type: 'select',
		label: N_('CHAR columns editing'),
		options: [
			{
				value: 'input',
				label: N_('input')
			},
			{
				value: 'textarea',
				label: N_('textarea')
			}
		],
		help: N_('Defines which type of editing controls should be used for CHAR and VARCHAR columns; input - allows limiting of input length, textarea - allows newlines in columns.'),
		default: 'input'
	},
	{
		path: 'CharTextareaCols',
		type: 'number',
		label: N_('CHAR textarea columns'),
		help: N_('Number of columns for CHAR/VARCHAR textareas.'),
		default: 40,
		min: 1
	},
	{
		path: 'CharTextareaRows',
		type: 'number',
		label: N_('CHAR textarea rows'),
		help: N_('Number of rows for CHAR/VARCHAR textareas.'),
		default: 7,
		min: 1
	},
	{
		path: 'CodemirrorEnable',
		type: 'bool',
		label: N_('Enable CodeMirror'),
		help: N_('Use user-friendly editor for editing SQL queries (CodeMirror) with syntax highlighting and line numbers.'),
		default: true
	},
	{
		path: 'Confirm',
		type: 'bool',
		label: N_('Confirm DROP queries'),
		help: N_('Whether a warning ("Are your really sure…") should be displayed when you\'re about to lose data.'),
		default: true
	},
	{
		path: 'Console/AlwaysExpand',
		type: 'bool',
		label: N_('Always expand query messages'),
		default: false
	},
	{
		path: 'Console/CurrentQuery',
		type: 'bool',
		label: N_('Show current browsing query'),
		default: true
	},
	{
		path: 'Console/DarkTheme',
		type: 'bool',
		label: N_('Switch to dark theme'),
		default: false
	},
	{
		path: 'Console/EnterExecutes',
		type: 'bool',
		label: N_('Execute queries on Enter and insert new line with Shift+Enter'),
		default: false
	},
	{
		path: 'Console/GroupQueries',
		type: 'bool',
		label: N_('Group queries'),
		default: false
	},
	{
		path: 'Console/Height',
		type: 'number',
		label: N_('Console height'),
		default: 92,
		min: 1
	},
	{
		path: 'Console/Mode',
		type: 'select',
		label: N_('Console mode'),
		options: [
			{
				value: 'info',
				label: N_('info')
			},
			{
				value: 'show',
				label: N_('show')
			},
			{
				value: 'collapse',
				label: N_('collapse')
			}
		],
		default: 'info'
	},
	{
		path: 'Console/Order',
		type: 'select',
		label: N_('Order'),
		options: [
			{
				value: 'asc',
				label: N_('asc')
			},
			{
				value: 'desc',
				label: N_('desc')
			}
		],
		default: 'asc'
	},
	{
		path: 'Console/OrderBy',
		type: 'select',
		label: N_('Order by'),
		options: [
			{
				value: 'exec',
				label: N_('exec')
			},
			{
				value: 'time',
				label: N_('time')
			},
			{
				value: 'count',
				label: N_('count')
			}
		],
		default: 'exec'
	},
	{
		path: 'Console/StartHistory',
		type: 'bool',
		label: N_('Show query history at start'),
		default: false
	},
	{
		path: 'ConsoleEnterExecutes',
		type: 'bool',
		label: N_('Enter executes queries in console'),
		help: N_('Queries are executed by pressing Enter (instead of Ctrl+Enter). New lines will be inserted with Shift+Enter.'),
		default: false
	},
	{
		path: 'DBG/sql',
		type: 'bool',
		label: N_('Debug SQL'),
		help: N_('Log SQL queries and their execution time, to be displayed in the console'),
		default: false
	},
	{
		path: 'DefaultConnectionCollation',
		type: 'text',
		label: N_('Server connection collation'),
		default: 'utf8mb4_unicode_ci'
	},
	{
		path: 'DefaultForeignKeyChecks',
		type: 'select',
		label: N_('Foreign key checks'),
		options: [
			{
				value: 'default',
				label: N_('Server default')
			},
			{
				value: 'enable',
				label: N_('Enable')
			},
			{
				value: 'disable',
				label: N_('Disable')
			}
		],
		help: N_('Default value for foreign key checks checkbox for some queries.'),
		default: 'default'
	},
	{
		path: 'DefaultTabDatabase',
		type: 'select',
		label: N_('Default database tab'),
		options: [
			{
				value: 'structure',
				label: N_('Structure')
			},
			{
				value: 'sql',
				label: N_('SQL')
			},
			{
				value: 'search',
				label: N_('Search')
			},
			{
				value: 'operations',
				label: N_('Operations')
			}
		],
		help: N_('Tab that is displayed when entering a database.'),
		default: 'structure'
	},
	{
		path: 'DefaultTabServer',
		type: 'select',
		label: N_('Default server tab'),
		options: [
			{
				value: 'welcome',
				label: N_('Welcome')
			},
			{
				value: 'databases',
				label: N_('Databases')
			},
			{
				value: 'status',
				label: N_('Status')
			},
			{
				value: 'variables',
				label: N_('Variables')
			},
			{
				value: 'privileges',
				label: N_('Privileges')
			}
		],
		help: N_('Tab that is displayed when entering a server.'),
		default: 'welcome'
	},
	{
		path: 'DefaultTabTable',
		type: 'select',
		label: N_('Default table tab'),
		options: [
			{
				value: 'structure',
				label: N_('Structure')
			},
			{
				value: 'sql',
				label: N_('SQL')
			},
			{
				value: 'search',
				label: N_('Search')
			},
			{
				value: 'insert',
				label: N_('Insert')
			},
			{
				value: 'browse',
				label: N_('Browse')
			}
		],
		help: N_('Tab that is displayed when entering a table.'),
		default: 'browse'
	},
	{
		path: 'DisableMultiTableMaintenance',
		type: 'bool',
		label: N_('Disable multi table maintenance'),
		help: N_('Disable the table maintenance mass operations, like optimizing or repairing the selected tables of a database.'),
		default: false
	},
	{
		path: 'DisableShortcutKeys',
		type: 'bool',
		label: N_('Disable shortcut keys'),
		help: N_('Disable shortcut keys'),
		default: false
	},
	{
		path: 'DisplayServersList',
		type: 'bool',
		label: N_('Display servers as a list'),
		help: N_('Show server listing as a list instead of a drop down.'),
		default: false
	},
	{
		path: 'EnableAutocompleteForTablesAndColumns',
		type: 'bool',
		label: N_('Enable autocomplete for table and column names'),
		help: N_('Autocomplete of the table and column names in the SQL queries.'),
		default: true
	},
	{
		path: 'Export/as_separate_files',
		type: 'bool',
		label: N_('Export as separate files'),
		default: false
	},
	{
		path: 'Export/charset',
		type: 'select',
		label: N_('Character set of the file'),
		options: [
			{
				value: '',
				label: ''
			},
			{
				value: 'iso-8859-1',
				label: N_('iso-8859-1')
			},
			{
				value: 'iso-8859-2',
				label: N_('iso-8859-2')
			},
			{
				value: 'iso-8859-3',
				label: N_('iso-8859-3')
			},
			{
				value: 'iso-8859-4',
				label: N_('iso-8859-4')
			},
			{
				value: 'iso-8859-5',
				label: N_('iso-8859-5')
			},
			{
				value: 'iso-8859-6',
				label: N_('iso-8859-6')
			},
			{
				value: 'iso-8859-7',
				label: N_('iso-8859-7')
			},
			{
				value: 'iso-8859-8',
				label: N_('iso-8859-8')
			},
			{
				value: 'iso-8859-9',
				label: N_('iso-8859-9')
			},
			{
				value: 'iso-8859-10',
				label: N_('iso-8859-10')
			},
			{
				value: 'iso-8859-11',
				label: N_('iso-8859-11')
			},
			{
				value: 'iso-8859-12',
				label: N_('iso-8859-12')
			},
			{
				value: 'iso-8859-13',
				label: N_('iso-8859-13')
			},
			{
				value: 'iso-8859-14',
				label: N_('iso-8859-14')
			},
			{
				value: 'iso-8859-15',
				label: N_('iso-8859-15')
			},
			{
				value: 'windows-1250',
				label: N_('windows-1250')
			},
			{
				value: 'windows-1251',
				label: N_('windows-1251')
			},
			{
				value: 'windows-1252',
				label: N_('windows-1252')
			},
			{
				value: 'windows-1256',
				label: N_('windows-1256')
			},
			{
				value: 'windows-1257',
				label: N_('windows-1257')
			},
			{
				value: 'koi8-r',
				label: N_('koi8-r')
			},
			{
				value: 'big5',
				label: N_('big5')
			},
			{
				value: 'gb2312',
				label: N_('gb2312')
			},
			{
				value: 'utf-16',
				label: N_('utf-16')
			},
			{
				value: 'utf-8',
				label: N_('utf-8')
			},
			{
				value: 'utf-7',
				label: N_('utf-7')
			},
			{
				value: 'x-user-defined',
				label: N_('x-user-defined')
			},
			{
				value: 'euc-jp',
				label: N_('euc-jp')
			},
			{
				value: 'ks_c_5601-1987',
				label: N_('ks_c_5601-1987')
			},
			{
				value: 'tis-620',
				label: N_('tis-620')
			},
			{
				value: 'SHIFT_JIS',
				label: N_('SHIFT_JIS')
			},
			{
				value: 'SJIS',
				label: N_('SJIS')
			},
			{
				value: 'SJIS-win',
				label: N_('SJIS-win')
			}
		],
		default: ''
	},
	{
		path: 'Export/codegen_format',
		type: 'select',
		label: N_('Format'),
		options: [
			{
				value: '#',
				label: N_('#')
			},
			{
				value: 'NHibernate C# DO',
				label: N_('NHibernate C# DO')
			},
			{
				value: 'NHibernate XML',
				label: N_('NHibernate XML')
			}
		],
		default: '#'
	},
	{
		path: 'Export/compression',
		type: 'select',
		label: N_('Compression'),
		options: [
			{
				value: 'none',
				label: N_('none')
			},
			{
				value: 'zip',
				label: N_('zip')
			},
			{
				value: 'gzip',
				label: N_('gzip')
			}
		],
		default: 'none'
	},
	{
		path: 'Export/csv_columns',
		type: 'bool',
		label: N_('Put columns names in the first row'),
		default: true
	},
	{
		path: 'Export/csv_enclosed',
		type: 'text',
		label: N_('Columns enclosed with'),
		default: '"'
	},
	{
		path: 'Export/csv_escaped',
		type: 'text',
		label: N_('Columns escaped with'),
		default: '"'
	},
	{
		path: 'Export/csv_null',
		type: 'text',
		label: N_('Replace NULL with'),
		default: 'NULL'
	},
	{
		path: 'Export/csv_removeCRLF',
		type: 'bool',
		label: N_('Remove CRLF characters within columns'),
		default: false
	},
	{
		path: 'Export/csv_separator',
		type: 'text',
		label: N_('Columns terminated with'),
		default: ','
	},
	{
		path: 'Export/csv_terminated',
		type: 'text',
		label: N_('Lines terminated with'),
		default: 'AUTO'
	},
	{
		path: 'Export/excel_columns',
		type: 'bool',
		label: N_('Put columns names in the first row'),
		default: true
	},
	{
		path: 'Export/excel_edition',
		type: 'select',
		label: N_('Excel edition'),
		options: [
			{
				value: 'win',
				label: N_('Windows')
			},
			{
				value: 'mac_excel2003',
				label: N_('Excel 2003 / Macintosh')
			},
			{
				value: 'mac_excel2008',
				label: N_('Excel 2008 / Macintosh')
			}
		],
		default: 'win'
	},
	{
		path: 'Export/excel_null',
		type: 'text',
		label: N_('Replace NULL with'),
		default: 'NULL'
	},
	{
		path: 'Export/excel_removeCRLF',
		type: 'bool',
		label: N_('Remove CRLF characters within columns'),
		default: false
	},
	{
		path: 'Export/file_template_database',
		type: 'text',
		label: N_('Database name template'),
		default: '@DATABASE@'
	},
	{
		path: 'Export/file_template_server',
		type: 'text',
		label: N_('Server name template'),
		default: '@SERVER@'
	},
	{
		path: 'Export/file_template_table',
		type: 'text',
		label: N_('Table name template'),
		default: '@TABLE@'
	},
	{
		path: 'Export/format',
		type: 'select',
		label: N_('Format'),
		options: [
			{
				value: 'codegen',
				label: N_('codegen')
			},
			{
				value: 'csv',
				label: N_('csv')
			},
			{
				value: 'excel',
				label: N_('excel')
			},
			{
				value: 'htmlexcel',
				label: N_('htmlexcel')
			},
			{
				value: 'htmlword',
				label: N_('htmlword')
			},
			{
				value: 'latex',
				label: N_('latex')
			},
			{
				value: 'ods',
				label: N_('ods')
			},
			{
				value: 'odt',
				label: N_('odt')
			},
			{
				value: 'pdf',
				label: N_('pdf')
			},
			{
				value: 'sql',
				label: N_('sql')
			},
			{
				value: 'texytext',
				label: N_('texytext')
			},
			{
				value: 'xml',
				label: N_('xml')
			},
			{
				value: 'yaml',
				label: N_('yaml')
			}
		],
		default: 'sql'
	},
	{
		path: 'Export/htmlword_columns',
		type: 'bool',
		label: N_('Put columns names in the first row'),
		default: false
	},
	{
		path: 'Export/htmlword_null',
		type: 'text',
		label: N_('Replace NULL with'),
		default: 'NULL'
	},
	{
		path: 'Export/htmlword_structure_or_data',
		type: 'select',
		label: N_('Dump table'),
		options: [
			{
				value: 'structure',
				label: N_('structure')
			},
			{
				value: 'data',
				label: N_('data')
			},
			{
				value: 'structure_and_data',
				label: N_('structure and data')
			}
		],
		default: 'structure_and_data'
	},
	{
		path: 'Export/latex_caption',
		type: 'bool',
		label: N_('Include table caption'),
		default: true
	},
	{
		path: 'Export/latex_columns',
		type: 'bool',
		label: N_('Put columns names in the first row'),
		default: true
	},
	{
		path: 'Export/latex_comments',
		type: 'bool',
		label: N_('Comments'),
		default: true
	},
	{
		path: 'Export/latex_data_caption',
		type: 'text',
		label: N_('Table caption'),
		default: 'strLatexContent'
	},
	{
		path: 'Export/latex_data_continued_caption',
		type: 'text',
		label: N_('Continued table caption'),
		default: 'strLatexContent strLatexContinued'
	},
	{
		path: 'Export/latex_data_label',
		type: 'text',
		label: N_('Label key'),
		default: 'tab:@TABLE@-data'
	},
	{
		path: 'Export/latex_mime',
		type: 'bool',
		label: N_('Media type'),
		default: true
	},
	{
		path: 'Export/latex_null',
		type: 'text',
		label: N_('Replace NULL with'),
		default: '\\textit{NULL}'
	},
	{
		path: 'Export/latex_relation',
		type: 'bool',
		label: N_('Relationships'),
		default: true
	},
	{
		path: 'Export/latex_structure_caption',
		type: 'text',
		label: N_('Table caption'),
		default: 'strLatexStructure'
	},
	{
		path: 'Export/latex_structure_continued_caption',
		type: 'text',
		label: N_('Continued table caption'),
		default: 'strLatexStructure strLatexContinued'
	},
	{
		path: 'Export/latex_structure_label',
		type: 'text',
		label: N_('Label key'),
		default: 'tab:@TABLE@-structure'
	},
	{
		path: 'Export/latex_structure_or_data',
		type: 'select',
		label: N_('Dump table'),
		options: [
			{
				value: 'structure',
				label: N_('structure')
			},
			{
				value: 'data',
				label: N_('data')
			},
			{
				value: 'structure_and_data',
				label: N_('structure and data')
			}
		],
		default: 'structure_and_data'
	},
	{
		path: 'Export/lock_tables',
		type: 'bool',
		label: N_('Use LOCK TABLES statement'),
		default: false
	},
	{
		path: 'Export/method',
		type: 'select',
		label: N_('Export method'),
		options: [
			{
				value: 'quick',
				label: N_('Quick - display only the minimal options to configure')
			},
			{
				value: 'custom',
				label: N_('Custom - display all possible options to configure')
			},
			{
				value: 'custom-no-form',
				label: N_('Custom - like above, but without the quick/custom choice')
			}
		],
		default: 'quick'
	},
	{
		path: 'Export/ods_columns',
		type: 'bool',
		label: N_('Put columns names in the first row'),
		default: false
	},
	{
		path: 'Export/ods_null',
		type: 'text',
		label: N_('Replace NULL with'),
		default: 'NULL'
	},
	{
		path: 'Export/odt_columns',
		type: 'bool',
		label: N_('Put columns names in the first row'),
		default: true
	},
	{
		path: 'Export/odt_comments',
		type: 'bool',
		label: N_('Comments'),
		default: true
	},
	{
		path: 'Export/odt_mime',
		type: 'bool',
		label: N_('Media type'),
		default: true
	},
	{
		path: 'Export/odt_null',
		type: 'text',
		label: N_('Replace NULL with'),
		default: 'NULL'
	},
	{
		path: 'Export/odt_relation',
		type: 'bool',
		label: N_('Relationships'),
		default: true
	},
	{
		path: 'Export/odt_structure_or_data',
		type: 'select',
		label: N_('Dump table'),
		options: [
			{
				value: 'structure',
				label: N_('structure')
			},
			{
				value: 'data',
				label: N_('data')
			},
			{
				value: 'structure_and_data',
				label: N_('structure and data')
			}
		],
		default: 'structure_and_data'
	},
	{
		path: 'Export/onserver',
		type: 'bool',
		label: N_('Save on server'),
		default: false
	},
	{
		path: 'Export/onserver_overwrite',
		type: 'bool',
		label: N_('Overwrite existing file(s)'),
		default: false
	},
	{
		path: 'Export/quick_export_onserver',
		type: 'bool',
		label: N_('Save on server'),
		default: false
	},
	{
		path: 'Export/quick_export_onserver_overwrite',
		type: 'bool',
		label: N_('Overwrite existing file(s)'),
		default: false
	},
	{
		path: 'Export/sql_auto_increment',
		type: 'bool',
		label: N_('Add AUTO_INCREMENT value'),
		default: true
	},
	{
		path: 'Export/sql_backquotes',
		type: 'bool',
		label: N_('Enclose table and column names with backquotes'),
		default: true
	},
	{
		path: 'Export/sql_compatibility',
		type: 'select',
		label: N_('SQL compatibility mode'),
		options: [
			{
				value: 'NONE',
				label: N_('NONE')
			},
			{
				value: 'ANSI',
				label: N_('ANSI')
			},
			{
				value: 'DB2',
				label: N_('DB2')
			},
			{
				value: 'MAXDB',
				label: N_('MAXDB')
			},
			{
				value: 'MYSQL323',
				label: N_('MYSQL323')
			},
			{
				value: 'MYSQL40',
				label: N_('MYSQL40')
			},
			{
				value: 'MSSQL',
				label: N_('MSSQL')
			},
			{
				value: 'ORACLE',
				label: N_('ORACLE')
			},
			{
				value: 'TRADITIONAL',
				label: N_('TRADITIONAL')
			}
		],
		default: 'NONE'
	},
	{
		path: 'Export/sql_create_database',
		type: 'bool',
		label: N_('Add CREATE DATABASE / USE'),
		default: false
	},
	{
		path: 'Export/sql_create_trigger',
		type: 'bool',
		label: N_('Add CREATE TRIGGER'),
		default: true
	},
	{
		path: 'Export/sql_dates',
		type: 'bool',
		label: N_('Creation/Update/Check dates'),
		default: false
	},
	{
		path: 'Export/sql_delayed',
		type: 'bool',
		label: N_('Use delayed inserts'),
		default: false
	},
	{
		path: 'Export/sql_disable_fk',
		type: 'bool',
		label: N_('Disable foreign key checks'),
		default: false
	},
	{
		path: 'Export/sql_drop_database',
		type: 'bool',
		label: N_('Add DROP DATABASE'),
		default: false
	},
	{
		path: 'Export/sql_drop_table',
		type: 'bool',
		label: N_('Add DROP TABLE / VIEW / PROCEDURE / FUNCTION / EVENT / TRIGGER'),
		default: false
	},
	{
		path: 'Export/sql_hex_for_binary',
		type: 'bool',
		label: N_('Use hexadecimal for BINARY & BLOB'),
		default: true
	},
	{
		path: 'Export/sql_if_not_exists',
		type: 'bool',
		label: N_('Add IF NOT EXISTS (less efficient as indexes will be generated during table creation)'),
		default: false
	},
	{
		path: 'Export/sql_ignore',
		type: 'bool',
		label: N_('Use ignore inserts'),
		default: false
	},
	{
		path: 'Export/sql_insert_syntax',
		type: 'select',
		label: N_('Syntax to use when inserting data'),
		options: [
			{
				value: 'complete',
				label: N_('complete inserts')
			},
			{
				value: 'extended',
				label: N_('extended inserts')
			},
			{
				value: 'both',
				label: N_('both of the above')
			},
			{
				value: 'none',
				label: N_('neither of the above')
			}
		],
		default: 'both'
	},
	{
		path: 'Export/sql_max_query_size',
		type: 'number',
		label: N_('Maximal length of created query'),
		default: 50000,
		min: 1
	},
	{
		path: 'Export/sql_metadata',
		type: 'bool',
		label: N_('Export related metadata from phpMyAdmin configuration storage'),
		default: false
	},
	{
		path: 'Export/sql_mime',
		type: 'bool',
		label: N_('Media type'),
		default: false
	},
	{
		path: 'Export/sql_or_replace_view',
		type: 'bool',
		label: N_('OR REPLACE view'),
		default: false
	},
	{
		path: 'Export/sql_procedure_function',
		type: 'bool',
		label: N_('Add CREATE PROCEDURE / FUNCTION / EVENT'),
		default: true
	},
	{
		path: 'Export/sql_relation',
		type: 'bool',
		label: N_('Relationships'),
		default: false
	},
	{
		path: 'Export/sql_structure_or_data',
		type: 'select',
		label: N_('Dump table'),
		options: [
			{
				value: 'structure',
				label: N_('structure')
			},
			{
				value: 'data',
				label: N_('data')
			},
			{
				value: 'structure_and_data',
				label: N_('structure and data')
			}
		],
		default: 'structure_and_data'
	},
	{
		path: 'Export/sql_type',
		type: 'select',
		label: N_('Export type'),
		options: [
			{
				value: 'INSERT',
				label: N_('INSERT')
			},
			{
				value: 'UPDATE',
				label: N_('UPDATE')
			},
			{
				value: 'REPLACE',
				label: N_('REPLACE')
			}
		],
		default: 'INSERT'
	},
	{
		path: 'Export/sql_use_transaction',
		type: 'bool',
		label: N_('Enclose export in a transaction'),
		default: true
	},
	{
		path: 'Export/sql_utc_time',
		type: 'bool',
		label: N_('Export time in UTC'),
		default: true
	},
	{
		path: 'Export/sql_view_current_user',
		type: 'bool',
		label: N_('Exclude definition of current user'),
		default: false
	},
	{
		path: 'Export/sql_views_as_tables',
		type: 'bool',
		label: N_('Export views as tables'),
		default: false
	},
	{
		path: 'Export/texytext_columns',
		type: 'bool',
		label: N_('Put columns names in the first row'),
		default: false
	},
	{
		path: 'Export/texytext_null',
		type: 'text',
		label: N_('Replace NULL with'),
		default: 'NULL'
	},
	{
		path: 'Export/texytext_structure_or_data',
		type: 'select',
		label: N_('Dump table'),
		options: [
			{
				value: 'structure',
				label: N_('structure')
			},
			{
				value: 'data',
				label: N_('data')
			},
			{
				value: 'structure_and_data',
				label: N_('structure and data')
			}
		],
		default: 'structure_and_data'
	},
	{
		path: 'FirstDayOfCalendar',
		type: 'select',
		label: N_('First day of calendar'),
		options: [
			{
				value: 0,
				label: N_('Default')
			},
			{
				value: 1,
				label: N_('Monday')
			},
			{
				value: 2,
				label: N_('Tuesday')
			},
			{
				value: 3,
				label: N_('Wednesday')
			},
			{
				value: 4,
				label: N_('Thursday')
			},
			{
				value: 5,
				label: N_('Friday')
			},
			{
				value: 6,
				label: N_('Saturday')
			},
			{
				value: 7,
				label: N_('Sunday')
			}
		],
		default: 0
	},
	{
		path: 'FirstLevelNavigationItems',
		type: 'number',
		label: N_('Maximum items on first level'),
		help: N_('The number of items that can be displayed on each page on the first level of the navigation tree.'),
		default: 100,
		min: 1
	},
	{
		path: 'ForeignKeyDropdownOrder',
		type: 'list',
		label: N_('Foreign key dropdown order'),
		help: N_('Sort order for items in a foreign-key dropdown box; content is the referenced data, id is the key value.'),
		default: ['content-id', 'id-content']
	},
	{
		path: 'ForeignKeyMaxLimit',
		type: 'number',
		label: N_('Foreign key limit'),
		help: N_('A dropdown will be used if fewer items are present.'),
		default: 100,
		min: 1
	},
	{
		path: 'GridEditing',
		type: 'select',
		label: N_('Grid editing: trigger action'),
		options: [
			{
				value: 'click',
				label: N_('Click')
			},
			{
				value: 'double-click',
				label: N_('Double click')
			},
			{
				value: 'disabled',
				label: N_('Disabled')
			}
		],
		default: 'double-click'
	},
	{
		path: 'HideStructureActions',
		type: 'bool',
		label: N_('Hide table structure actions'),
		help: N_('Whether the table structure actions should be hidden.'),
		default: true
	},
	{
		path: 'IgnoreMultiSubmitErrors',
		type: 'bool',
		label: N_('Ignore multiple statement errors'),
		help: N_('If enabled, phpMyAdmin continues computing multiple-statement queries even if one of the queries failed.'),
		default: false
	},
	{
		path: 'Import/allow_interrupt',
		type: 'bool',
		label: N_('Partial import: allow interrupt'),
		help: N_('Allow interrupt of import in case script detects it is close to time limit. This might be a good way to import large files, however it can break transactions.'),
		default: true
	},
	{
		path: 'Import/charset',
		type: 'select',
		label: N_('Character set of the file'),
		options: [
			{
				value: '',
				label: ''
			},
			{
				value: 'iso-8859-1',
				label: N_('iso-8859-1')
			},
			{
				value: 'iso-8859-2',
				label: N_('iso-8859-2')
			},
			{
				value: 'iso-8859-3',
				label: N_('iso-8859-3')
			},
			{
				value: 'iso-8859-4',
				label: N_('iso-8859-4')
			},
			{
				value: 'iso-8859-5',
				label: N_('iso-8859-5')
			},
			{
				value: 'iso-8859-6',
				label: N_('iso-8859-6')
			},
			{
				value: 'iso-8859-7',
				label: N_('iso-8859-7')
			},
			{
				value: 'iso-8859-8',
				label: N_('iso-8859-8')
			},
			{
				value: 'iso-8859-9',
				label: N_('iso-8859-9')
			},
			{
				value: 'iso-8859-10',
				label: N_('iso-8859-10')
			},
			{
				value: 'iso-8859-11',
				label: N_('iso-8859-11')
			},
			{
				value: 'iso-8859-12',
				label: N_('iso-8859-12')
			},
			{
				value: 'iso-8859-13',
				label: N_('iso-8859-13')
			},
			{
				value: 'iso-8859-14',
				label: N_('iso-8859-14')
			},
			{
				value: 'iso-8859-15',
				label: N_('iso-8859-15')
			},
			{
				value: 'windows-1250',
				label: N_('windows-1250')
			},
			{
				value: 'windows-1251',
				label: N_('windows-1251')
			},
			{
				value: 'windows-1252',
				label: N_('windows-1252')
			},
			{
				value: 'windows-1256',
				label: N_('windows-1256')
			},
			{
				value: 'windows-1257',
				label: N_('windows-1257')
			},
			{
				value: 'koi8-r',
				label: N_('koi8-r')
			},
			{
				value: 'big5',
				label: N_('big5')
			},
			{
				value: 'gb2312',
				label: N_('gb2312')
			},
			{
				value: 'utf-16',
				label: N_('utf-16')
			},
			{
				value: 'utf-8',
				label: N_('utf-8')
			},
			{
				value: 'utf-7',
				label: N_('utf-7')
			},
			{
				value: 'x-user-defined',
				label: N_('x-user-defined')
			},
			{
				value: 'euc-jp',
				label: N_('euc-jp')
			},
			{
				value: 'ks_c_5601-1987',
				label: N_('ks_c_5601-1987')
			},
			{
				value: 'tis-620',
				label: N_('tis-620')
			},
			{
				value: 'SHIFT_JIS',
				label: N_('SHIFT_JIS')
			},
			{
				value: 'SJIS',
				label: N_('SJIS')
			},
			{
				value: 'SJIS-win',
				label: N_('SJIS-win')
			}
		],
		default: ''
	},
	{
		path: 'Import/csv_col_names',
		type: 'bool',
		label: N_('The first line of the file contains the table column names'),
		default: false
	},
	{
		path: 'Import/csv_enclosed',
		type: 'text',
		label: N_('Columns enclosed with'),
		default: '"'
	},
	{
		path: 'Import/csv_escaped',
		type: 'text',
		label: N_('Columns escaped with'),
		default: '"'
	},
	{
		path: 'Import/csv_ignore',
		type: 'bool',
		label: N_('Do not abort on INSERT error'),
		default: false
	},
	{
		path: 'Import/csv_replace',
		type: 'bool',
		label: N_('Add ON DUPLICATE KEY UPDATE'),
		help: N_('Update data when duplicate keys found on import'),
		default: false
	},
	{
		path: 'Import/csv_terminated',
		type: 'text',
		label: N_('Columns terminated with'),
		default: ','
	},
	{
		path: 'Import/format',
		type: 'select',
		label: N_('Format of imported file'),
		options: [
			{
				value: 'csv',
				label: N_('csv')
			},
			{
				value: 'docsql',
				label: N_('docsql')
			},
			{
				value: 'ldi',
				label: N_('ldi')
			},
			{
				value: 'sql',
				label: N_('sql')
			}
		],
		help: N_('Default format; be aware that this list depends on location (database, table) and only SQL is always available.'),
		default: 'sql'
	},
	{
		path: 'Import/ldi_enclosed',
		type: 'text',
		label: N_('Columns enclosed with'),
		default: '"'
	},
	{
		path: 'Import/ldi_escaped',
		type: 'text',
		label: N_('Columns escaped with'),
		default: '\\'
	},
	{
		path: 'Import/ldi_ignore',
		type: 'bool',
		label: N_('Do not abort on INSERT error'),
		default: false
	},
	{
		path: 'Import/ldi_local_option',
		type: 'select',
		label: N_('Use LOCAL keyword'),
		options: [
			{
				value: 'auto',
				label: N_('auto')
			},
			{
				value: true,
				label: N_('Yes')
			},
			{
				value: false,
				label: N_('No')
			}
		],
		default: 'auto'
	},
	{
		path: 'Import/ldi_replace',
		type: 'bool',
		label: N_('Add ON DUPLICATE KEY UPDATE'),
		help: N_('Update data when duplicate keys found on import'),
		default: false
	},
	{
		path: 'Import/ldi_terminated',
		type: 'text',
		label: N_('Columns terminated with'),
		default: ';'
	},
	{
		path: 'Import/ods_col_names',
		type: 'bool',
		label: N_('Column names in first row'),
		default: false
	},
	{
		path: 'Import/ods_empty_rows',
		type: 'bool',
		label: N_('Do not import empty rows'),
		default: true
	},
	{
		path: 'Import/ods_recognize_currency',
		type: 'bool',
		label: N_('Import currencies ($5.00 to 5.00)'),
		default: true
	},
	{
		path: 'Import/ods_recognize_percentages',
		type: 'bool',
		label: N_('Import percentages as proper decimals (12.00% to .12)'),
		default: true
	},
	{
		path: 'Import/skip_queries',
		type: 'number',
		label: N_('Partial import: skip queries'),
		help: N_('Number of queries to skip from start.'),
		default: 0,
		min: 0
	},
	{
		path: 'Import/sql_compatibility',
		type: 'select',
		label: N_('SQL compatibility mode'),
		options: [
			{
				value: 'NONE',
				label: N_('NONE')
			},
			{
				value: 'ANSI',
				label: N_('ANSI')
			},
			{
				value: 'DB2',
				label: N_('DB2')
			},
			{
				value: 'MAXDB',
				label: N_('MAXDB')
			},
			{
				value: 'MYSQL323',
				label: N_('MYSQL323')
			},
			{
				value: 'MYSQL40',
				label: N_('MYSQL40')
			},
			{
				value: 'MSSQL',
				label: N_('MSSQL')
			},
			{
				value: 'ORACLE',
				label: N_('ORACLE')
			},
			{
				value: 'TRADITIONAL',
				label: N_('TRADITIONAL')
			}
		],
		default: 'NONE'
	},
	{
		path: 'Import/sql_no_auto_value_on_zero',
		type: 'bool',
		label: N_('Do not use AUTO_INCREMENT for zero values'),
		default: true
	},
	{
		path: 'Import/sql_read_as_multibytes',
		type: 'bool',
		label: N_('Read as multibytes'),
		default: false
	},
	{
		path: 'InitialSlidersState',
		type: 'select',
		label: N_('Initial state for sliders'),
		options: [
			{
				value: 'open',
				label: N_('Open')
			},
			{
				value: 'closed',
				label: N_('Closed')
			},
			{
				value: 'disabled',
				label: N_('Disabled')
			}
		],
		default: 'closed'
	},
	{
		path: 'InsertRows',
		type: 'number',
		label: N_('Number of inserted rows'),
		help: N_('How many rows can be inserted at one time.'),
		default: 2,
		min: 1
	},
	{
		path: 'LimitChars',
		type: 'number',
		label: N_('Limit column characters'),
		help: N_('Maximum number of characters shown in any non-numeric column on browse view.'),
		default: 50,
		min: 1
	},
	{
		path: 'LintEnable',
		type: 'bool',
		label: N_('Enable linter'),
		help: N_('Find any errors in the query before executing it. Requires CodeMirror to be enabled.'),
		default: true
	},
	{
		path: 'LoginCookieValidityDisableWarning',
		type: 'bool',
		label: N_('Login cookie validity warning'),
		help: N_('Disable the default warning that is displayed on the main page if the value of the PHP setting session.gc_maxlifetime is less than the value of `LoginCookieValidity`.'),
		default: false
	},
	{
		path: 'LongtextDoubleTextarea',
		type: 'bool',
		label: N_('Bigger textarea for LONGTEXT'),
		help: N_('Double size of textarea for LONGTEXT columns.'),
		default: true
	},
	{
		path: 'MaxCharactersInDisplayedSQL',
		type: 'number',
		label: N_('Maximum displayed SQL length'),
		help: N_('Maximum number of characters used when a SQL query is displayed.'),
		default: 1000,
		min: 1
	},
	{
		path: 'MaxDbList',
		type: 'number',
		label: N_('Maximum databases'),
		help: N_('Maximum number of databases displayed in database list.'),
		comment: N_('Users cannot set a higher value'),
		default: 100,
		min: 1
	},
	{
		path: 'MaxNavigationItems',
		type: 'number',
		label: N_('Maximum items in branch'),
		help: N_('The number of items that can be displayed on each page of the navigation tree.'),
		default: 50,
		min: 1
	},
	{
		path: 'MaxRows',
		type: 'number',
		label: N_('Maximum number of rows to display'),
		help: N_('Number of rows displayed when browsing a result set. If the result set contains more rows, "Previous" and "Next" links will be shown.'),
		default: 25,
		min: 1
	},
	{
		path: 'MaxSizeForInputField',
		type: 'number',
		label: N_('Maximum size for input field'),
		help: N_('Defines the maximum size for input fields generated for CHAR and VARCHAR columns.'),
		default: 60,
		min: 1
	},
	{
		path: 'MaxTableList',
		type: 'number',
		label: N_('Maximum tables'),
		help: N_('Maximum number of tables displayed in table list.'),
		comment: N_('Users cannot set a higher value'),
		default: 250,
		min: 1
	},
	{
		path: 'MinSizeForInputField',
		type: 'number',
		label: N_('Minimum size for input field'),
		help: N_('Defines the minimum size for input fields generated for CHAR and VARCHAR columns.'),
		default: 4,
		min: 0
	},
	{
		path: 'NaturalOrder',
		type: 'bool',
		label: N_('Natural order'),
		help: N_('Use natural order for sorting table and database names.'),
		default: true
	},
	{
		path: 'NavigationDisplayLogo',
		type: 'bool',
		label: N_('Display logo'),
		help: N_('Show logo in navigation panel.'),
		default: true
	},
	{
		path: 'NavigationDisplayServers',
		type: 'bool',
		label: N_('Display servers selection'),
		help: N_('Display server choice at the top of the navigation panel.'),
		default: true
	},
	{
		path: 'NavigationLinkWithMainPanel',
		type: 'bool',
		label: N_('Link with main panel'),
		help: N_('Link with main panel by highlighting the current database or table.'),
		default: true
	},
	{
		path: 'NavigationLogoLink',
		type: 'text',
		label: N_('Logo link URL'),
		help: N_('URL where logo in the navigation panel will point to.'),
		default: 'index.php'
	},
	{
		path: 'NavigationLogoLinkWindow',
		type: 'select',
		label: N_('Logo link target'),
		options: [
			{
				value: 'main',
				label: N_('main')
			},
			{
				value: 'new',
				label: N_('new')
			}
		],
		help: N_('Open the linked page in the main window (main) or in a new one (new).'),
		default: 'main'
	},
	{
		path: 'NavigationTreeAutoexpandSingleDb',
		type: 'bool',
		label: N_('Expand single database'),
		help: N_('Whether to expand single database in the navigation tree automatically.'),
		default: true
	},
	{
		path: 'NavigationTreeDbSeparator',
		type: 'text',
		label: N_('Database tree separator'),
		help: N_('String that separates databases into different tree levels.'),
		default: '_'
	},
	{
		path: 'NavigationTreeDefaultTabTable',
		type: 'select',
		label: N_('Target for quick access icon'),
		options: [
			{
				value: 'structure',
				label: N_('Structure')
			},
			{
				value: 'sql',
				label: N_('SQL')
			},
			{
				value: 'search',
				label: N_('Search')
			},
			{
				value: 'insert',
				label: N_('Insert')
			},
			{
				value: 'browse',
				label: N_('Browse')
			}
		],
		default: 'structure'
	},
	{
		path: 'NavigationTreeDefaultTabTable2',
		type: 'select',
		label: N_('Target for second quick access icon'),
		options: [
			{
				value: '',
				label: ''
			},
			{
				value: 'structure',
				label: N_('Structure')
			},
			{
				value: 'sql',
				label: N_('SQL')
			},
			{
				value: 'search',
				label: N_('Search')
			},
			{
				value: 'insert',
				label: N_('Insert')
			},
			{
				value: 'browse',
				label: N_('Browse')
			}
		],
		default: ''
	},
	{
		path: 'NavigationTreeDisplayDbFilterMinimum',
		type: 'number',
		label: N_('Minimum number of databases to display the database filter box'),
		default: 30,
		min: 0
	},
	{
		path: 'NavigationTreeDisplayItemFilterMinimum',
		type: 'number',
		label: N_('Minimum number of items to display the filter box'),
		help: N_('Defines the minimum number of items (tables, views, routines and events) to display a filter box.'),
		default: 30,
		min: 1
	},
	{
		path: 'NavigationTreeEnableExpansion',
		type: 'bool',
		label: N_('Enable navigation tree expansion'),
		help: N_('Whether to offer the possibility of tree expansion in the navigation panel.'),
		default: true
	},
	{
		path: 'NavigationTreeEnableGrouping',
		type: 'bool',
		label: N_('Group items in the tree'),
		help: N_('Group items in the navigation tree (determined by the separator defined in the Databases and Tables tabs above).'),
		default: true
	},
	{
		path: 'NavigationTreePointerEnable',
		type: 'bool',
		label: N_('Enable highlighting'),
		help: N_('Highlight server under the mouse cursor.'),
		default: true
	},
	{
		path: 'NavigationTreeShowEvents',
		type: 'bool',
		label: N_('Show events in tree'),
		help: N_('Whether to show events under database in the navigation tree'),
		default: true
	},
	{
		path: 'NavigationTreeShowFunctions',
		type: 'bool',
		label: N_('Show functions in tree'),
		help: N_('Whether to show functions under database in the navigation tree'),
		default: true
	},
	{
		path: 'NavigationTreeShowProcedures',
		type: 'bool',
		label: N_('Show procedures in tree'),
		help: N_('Whether to show procedures under database in the navigation tree'),
		default: true
	},
	{
		path: 'NavigationTreeShowTables',
		type: 'bool',
		label: N_('Show tables in tree'),
		help: N_('Whether to show tables under database in the navigation tree'),
		default: true
	},
	{
		path: 'NavigationTreeShowViews',
		type: 'bool',
		label: N_('Show views in tree'),
		help: N_('Whether to show views under database in the navigation tree'),
		default: true
	},
	{
		path: 'NavigationTreeTableLevel',
		type: 'number',
		label: N_('Maximum table tree depth'),
		default: 1,
		min: 1
	},
	{
		path: 'NavigationTreeTableSeparator',
		type: 'text',
		label: N_('Table tree separator'),
		help: N_('String that separates tables into different tree levels.'),
		default: '__'
	},
	{
		path: 'NavigationWidth',
		type: 'number',
		label: N_('Navigation panel width'),
		help: N_('Set to 0 to collapse navigation panel.'),
		default: 240,
		min: 0
	},
	{
		path: 'NumFavoriteTables',
		type: 'number',
		label: N_('Favorite tables'),
		help: N_('Maximum number of favorite tables; set 0 to disable.'),
		default: 10,
		min: 0
	},
	{
		path: 'NumRecentTables',
		type: 'number',
		label: N_('Recently used tables'),
		help: N_('Maximum number of recently used tables; set 0 to disable.'),
		default: 10,
		min: 0
	},
	{
		path: 'Order',
		type: 'select',
		label: N_('Default sorting order'),
		options: [
			{
				value: 'ASC',
				label: N_('ASC')
			},
			{
				value: 'DESC',
				label: N_('DESC')
			},
			{
				value: 'SMART',
				label: N_('SMART')
			}
		],
		help: N_('SMART - i.e. descending order for columns of type TIME, DATE, DATETIME and TIMESTAMP, ascending order otherwise.'),
		default: 'SMART'
	},
	{
		path: 'PDFDefaultPageSize',
		type: 'select',
		label: N_('Paper size'),
		options: [
			{
				value: 'A3',
				label: N_('A3')
			},
			{
				value: 'A4',
				label: N_('A4')
			},
			{
				value: 'A5',
				label: N_('A5')
			},
			{
				value: 'letter',
				label: N_('letter')
			},
			{
				value: 'legal',
				label: N_('legal')
			}
		],
		default: 'A4'
	},
	{
		path: 'PmaNoRelation_DisableWarning',
		type: 'bool',
		label: N_('Missing phpMyAdmin configuration storage tables'),
		help: N_('Disable the default warning that is displayed on the database details Structure page if any of the required tables for the phpMyAdmin configuration storage could not be found.'),
		default: false
	},
	{
		path: 'ProtectBinary',
		type: 'select',
		label: N_('Protect binary columns'),
		options: [
			{
				value: false,
				label: N_('Off')
			},
			{
				value: 'blob',
				label: N_('blob')
			},
			{
				value: 'noblob',
				label: N_('noblob')
			},
			{
				value: 'all',
				label: N_('all')
			}
		],
		help: N_('Disallow BLOB and BINARY columns from editing.'),
		default: 'blob'
	},
	{
		path: 'QueryHistoryMax',
		type: 'number',
		label: N_('Query history length'),
		help: N_('How many queries are kept in history.'),
		comment: N_('Users cannot set a higher value'),
		default: 25,
		min: 1
	},
	{
		path: 'RelationalDisplay',
		type: 'select',
		label: N_('Relational display'),
		options: [
			{
				value: 'K',
				label: N_('key')
			},
			{
				value: 'D',
				label: N_('display column')
			}
		],
		help: N_('For display Options'),
		default: 'K'
	},
	{
		path: 'RememberSorting',
		type: 'bool',
		label: N_("Remember table's sorting"),
		help: N_('When browsing tables, the sorting of each table is remembered.'),
		default: true
	},
	{
		path: 'RepeatCells',
		type: 'number',
		label: N_('Repeat headers'),
		help: N_('Repeat the headers every X cells, 0 deactivates this feature.'),
		default: 100,
		min: 0
	},
	{
		path: 'ReservedWordDisableWarning',
		type: 'bool',
		label: N_('MySQL reserved word warning'),
		help: N_('Disable the default warning that is displayed on the Structure page if column names in a table are reserved MySQL words.'),
		default: false
	},
	{
		path: 'RetainQueryBox',
		type: 'bool',
		label: N_('Retain query box'),
		help: N_('Defines whether the query box should stay on-screen after its submission.'),
		default: false
	},
	{
		path: 'RowActionLinks',
		type: 'select',
		label: N_('Where to show the table row links'),
		options: [
			{
				value: 'none',
				label: N_('Nowhere')
			},
			{
				value: 'left',
				label: N_('Left')
			},
			{
				value: 'right',
				label: N_('Right')
			},
			{
				value: 'both',
				label: N_('Both')
			}
		],
		help: N_('These are Edit, Copy and Delete links.'),
		default: 'left'
	},
	{
		path: 'RowActionLinksWithoutUnique',
		type: 'bool',
		label: N_('Show row links anyway'),
		help: N_('Whether to show row links even in the absence of a unique key.'),
		default: false
	},
	{
		path: 'SQLQuery/Edit',
		type: 'bool',
		label: N_('Edit'),
		default: true
	},
	{
		path: 'SQLQuery/Explain',
		type: 'bool',
		label: N_('Explain SQL'),
		default: true
	},
	{
		path: 'SQLQuery/Refresh',
		type: 'bool',
		label: N_('Refresh'),
		default: true
	},
	{
		path: 'SQLQuery/ShowAsPHP',
		type: 'bool',
		label: N_('Create PHP code'),
		default: true
	},
	{
		path: 'SaveCellsAtOnce',
		type: 'bool',
		label: N_('Grid editing: save all edited cells at once'),
		default: false
	},
	{
		path: 'SendErrorReports',
		type: 'select',
		label: N_('Send error reports'),
		options: [
			{
				value: 'ask',
				label: N_('Ask before sending error reports')
			},
			{
				value: 'always',
				label: N_('Always send error reports')
			},
			{
				value: 'never',
				label: N_('Never send error reports')
			}
		],
		help: N_('Choose the default action when sending error reports.'),
		default: 'ask'
	},
	{
		path: 'Server/hide_db',
		type: 'text',
		label: N_('Hide databases'),
		help: N_('Hide databases matching regular expression (PCRE).'),
		default: ''
	},
	{
		path: 'Server/only_db',
		type: 'text',
		label: N_('Show only listed databases'),
		help: N_("You can use MySQL wildcard characters (% and _), escape them if you want to use their literal instances, i.e. use 'my\\_db' and not 'my_db'."),
		default: ''
	},
	{
		path: 'ShowAll',
		type: 'bool',
		label: N_('Allow to display all the rows'),
		help: N_('Whether a user should be displayed a "show all (rows)" button.'),
		default: false
	},
	{
		path: 'ShowColumnComments',
		type: 'bool',
		label: N_('Show column comments'),
		help: N_('Whether column comments should be shown in table structure view'),
		default: true
	},
	{
		path: 'ShowCreateDb',
		type: 'bool',
		label: N_('Show create database form'),
		default: true
	},
	{
		path: 'ShowDatabasesNavigationAsTree',
		type: 'bool',
		label: N_('Show databases navigation as tree'),
		help: N_('In the navigation panel, replaces the database tree with a selector'),
		default: true
	},
	{
		path: 'ShowDbStructureCharset',
		type: 'bool',
		label: N_('Show table charset'),
		help: N_('Show or hide a column displaying the charset for all tables.'),
		default: false
	},
	{
		path: 'ShowDbStructureComment',
		type: 'bool',
		label: N_('Show table comments'),
		help: N_('Show or hide a column displaying the comments for all tables.'),
		default: false
	},
	{
		path: 'ShowDbStructureCreation',
		type: 'bool',
		label: N_('Show creation timestamp'),
		help: N_('Show or hide a column displaying the Creation timestamp for all tables.'),
		default: false
	},
	{
		path: 'ShowDbStructureLastCheck',
		type: 'bool',
		label: N_('Show last check timestamp'),
		help: N_('Show or hide a column displaying the Last check timestamp for all tables.'),
		default: false
	},
	{
		path: 'ShowDbStructureLastUpdate',
		type: 'bool',
		label: N_('Show last update timestamp'),
		help: N_('Show or hide a column displaying the Last update timestamp for all tables.'),
		default: false
	},
	{
		path: 'ShowFieldTypesInDataEditView',
		type: 'bool',
		label: N_('Show field types'),
		help: N_('Defines whether or not type fields should be initially displayed in edit/insert mode.'),
		default: true
	},
	{
		path: 'ShowFunctionFields',
		type: 'bool',
		label: N_('Show function fields'),
		help: N_('Display the function fields in edit/insert mode.'),
		default: true
	},
	{
		path: 'ShowHint',
		type: 'bool',
		label: N_('Show hint'),
		help: N_('Whether to show hint or not.'),
		default: true
	},
	{
		path: 'ShowSQL',
		type: 'bool',
		label: N_('Show SQL queries'),
		help: N_('Defines whether SQL queries generated by phpMyAdmin should be displayed.'),
		default: true
	},
	{
		path: 'ShowServerInfo',
		type: 'bool',
		label: N_('Show detailed MySQL server information'),
		default: true
	},
	{
		path: 'ShowStats',
		type: 'bool',
		label: N_('Show statistics'),
		help: N_('Allow to display database and table statistics (e.g. space usage).'),
		default: true
	},
	{
		path: 'SkipLockedTables',
		type: 'bool',
		label: N_('Skip locked tables'),
		help: N_('Mark used tables and make it possible to show databases with locked tables.'),
		default: false
	},
	{
		path: 'SuhosinDisableWarning',
		type: 'bool',
		label: N_('Suhosin warning'),
		help: N_('Disable the default warning that is displayed on the main page if Suhosin is detected.'),
		default: false
	},
	{
		path: 'TableNavigationLinksMode',
		type: 'select',
		label: N_('Table navigation bar'),
		options: [
			{
				value: 'icons',
				label: N_('Icons')
			},
			{
				value: 'text',
				label: N_('Text')
			},
			{
				value: 'both',
				label: N_('Both')
			}
		],
		help: N_('Use only icons, only text or both.'),
		default: 'icons'
	},
	{
		path: 'TablePrimaryKeyOrder',
		type: 'select',
		label: N_('Primary key default sort order'),
		options: [
			{
				value: 'NONE',
				label: N_('None')
			},
			{
				value: 'ASC',
				label: N_('Ascending')
			},
			{
				value: 'DESC',
				label: N_('Descending')
			}
		],
		help: N_('Default sort order for tables with a primary key.'),
		default: 'NONE'
	},
	{
		path: 'TabsMode',
		type: 'select',
		label: N_('How to display the menu tabs'),
		options: [
			{
				value: 'icons',
				label: N_('Icons')
			},
			{
				value: 'text',
				label: N_('Text')
			},
			{
				value: 'both',
				label: N_('Both')
			}
		],
		help: N_('Use only icons, only text or both.'),
		default: 'both'
	},
	{
		path: 'TextareaCols',
		type: 'number',
		label: N_('Textarea columns'),
		help: N_('Textarea size (columns) in edit mode, this value will be emphasized for SQL query textareas (*2).'),
		default: 40,
		min: 1
	},
	{
		path: 'TextareaRows',
		type: 'number',
		label: N_('Textarea rows'),
		help: N_('Textarea size (rows) in edit mode, this value will be emphasized for SQL query textareas (*2).'),
		default: 15,
		min: 1
	},
	{
		path: 'TitleDatabase',
		type: 'text',
		label: N_('Database'),
		help: N_('Title of browser window when a database is selected.'),
		default: '@HTTP_HOST@ / @VSERVER@ / @DATABASE@ | @PHPMYADMIN@'
	},
	{
		path: 'TitleDefault',
		type: 'text',
		label: N_('Default title'),
		help: N_('Title of browser window when nothing is selected.'),
		default: '@HTTP_HOST@ | @PHPMYADMIN@'
	},
	{
		path: 'TitleServer',
		type: 'text',
		label: N_('Server'),
		help: N_('Title of browser window when a server is selected.'),
		default: '@HTTP_HOST@ / @VSERVER@ | @PHPMYADMIN@'
	},
	{
		path: 'TitleTable',
		type: 'text',
		label: N_('Table'),
		help: N_('Title of browser window when a table is selected.'),
		default: '@HTTP_HOST@ / @VSERVER@ / @DATABASE@ / @TABLE@ | @PHPMYADMIN@'
	},
	{
		path: 'VersionCheck',
		type: 'bool',
		label: N_('Version check'),
		help: N_('Enables check for latest version on main phpMyAdmin page.'),
		default: true
	},
	{
		path: 'enable_drag_drop_import',
		type: 'bool',
		label: N_('Enable drag and drop import'),
		help: N_('Uncheck the checkbox to disable drag and drop import'),
		default: true
	}
];
