/**
 * The user preference forms: exact key lists of libraries/classes/Config/Forms/User/*Form.php
 * (FeaturesForm, SqlForm, NaviForm, MainForm, ExportForm, ImportForm). `Servers/1/only_db` and
 * `Servers/1/hide_db` are stored as `Server/only_db` / `Server/hide_db` (UserPreferences::pageInit mapping).
 *
 * Deviations: `LoginCookieValidity` is not user-settable here (it is read before any user is known), and
 * the `DefaultTransformations/*` arrays are preserved but have no editor (they belong to the column
 * transformations feature).
 */
import { FIELDS, type FieldDef } from './fields.ts';

export interface FormSection {
	id: string;
	title: string;
	description?: string;
	keys: string[];
}

export interface PrefForm {
	id: string;
	title: string;
	sections: FormSection[];
}

const sec = (id: string, title: string, keys: string[], description?: string): FormSection => ({
	id,
	title,
	keys,
	description
});

export const PREF_FORMS: PrefForm[] = [
	{
		id: 'features',
		title: 'Features',
		sections: [
			sec(
				'General',
				'General',
				[
					'VersionCheck',
					'NaturalOrder',
					'InitialSlidersState',
					'SkipLockedTables',
					'DisableMultiTableMaintenance',
					'ShowHint',
					'SendErrorReports',
					'ConsoleEnterExecutes',
					'DisableShortcutKeys',
					'FirstDayOfCalendar'
				],
				'Set some commonly used options.'
			),
			sec(
				'Databases',
				'Databases',
				[
					'Server/only_db',
					'Server/hide_db',
					'MaxDbList',
					'MaxTableList',
					'DefaultConnectionCollation'
				],
				'Databases display options.'
			),
			sec(
				'Text_fields',
				'Text fields',
				[
					'CharEditing',
					'MinSizeForInputField',
					'MaxSizeForInputField',
					'CharTextareaCols',
					'CharTextareaRows',
					'TextareaCols',
					'TextareaRows',
					'LongtextDoubleTextarea'
				],
				'Customize text input fields.'
			),
			sec(
				'Page_titles',
				'Page titles',
				['TitleDefault', 'TitleTable', 'TitleDatabase', 'TitleServer'],
				"Specify browser's title bar text. Refer to documentation for magic strings that can be used to get special values."
			),
			sec(
				'Warnings',
				'Warnings',
				[
					'PmaNoRelation_DisableWarning',
					'SuhosinDisableWarning',
					'LoginCookieValidityDisableWarning',
					'ReservedWordDisableWarning'
				],
				'Disable some of the warnings shown by phpMyAdmin.'
			),
			sec('Console', 'Console', [
				'Console/Mode',
				'Console/StartHistory',
				'Console/AlwaysExpand',
				'Console/CurrentQuery',
				'Console/EnterExecutes',
				'Console/DarkTheme',
				'Console/Height',
				'Console/GroupQueries',
				'Console/OrderBy',
				'Console/Order'
			])
		]
	},
	{
		id: 'sql',
		title: 'SQL queries',
		sections: [
			sec(
				'Sql_queries',
				'SQL queries',
				[
					'ShowSQL',
					'Confirm',
					'QueryHistoryMax',
					'IgnoreMultiSubmitErrors',
					'MaxCharactersInDisplayedSQL',
					'RetainQueryBox',
					'CodemirrorEnable',
					'LintEnable',
					'EnableAutocompleteForTablesAndColumns',
					'DefaultForeignKeyChecks'
				],
				'SQL queries settings.'
			),
			sec(
				'Sql_box',
				'SQL Query box',
				['SQLQuery/Edit', 'SQLQuery/Explain', 'SQLQuery/ShowAsPHP', 'SQLQuery/Refresh'],
				'Customize links shown in SQL Query boxes.'
			)
		]
	},
	{
		id: 'navigation',
		title: 'Navigation panel',
		sections: [
			sec(
				'Navi_panel',
				'Navigation panel',
				[
					'ShowDatabasesNavigationAsTree',
					'NavigationLinkWithMainPanel',
					'NavigationDisplayLogo',
					'NavigationLogoLink',
					'NavigationLogoLinkWindow',
					'NavigationTreePointerEnable',
					'FirstLevelNavigationItems',
					'NavigationTreeDisplayItemFilterMinimum',
					'NumRecentTables',
					'NumFavoriteTables',
					'NavigationWidth'
				],
				'Customize appearance of the navigation panel.'
			),
			sec(
				'Navi_tree',
				'Navigation tree',
				[
					'MaxNavigationItems',
					'NavigationTreeEnableGrouping',
					'NavigationTreeEnableExpansion',
					'NavigationTreeShowTables',
					'NavigationTreeShowViews',
					'NavigationTreeShowFunctions',
					'NavigationTreeShowProcedures',
					'NavigationTreeShowEvents',
					'NavigationTreeAutoexpandSingleDb'
				],
				'Customize the navigation tree.'
			),
			sec(
				'Navi_servers',
				'Servers',
				['NavigationDisplayServers', 'DisplayServersList'],
				'Servers display options.'
			),
			sec(
				'Navi_databases',
				'Databases',
				['NavigationTreeDisplayDbFilterMinimum', 'NavigationTreeDbSeparator'],
				'Databases display options.'
			),
			sec(
				'Navi_tables',
				'Tables',
				[
					'NavigationTreeDefaultTabTable',
					'NavigationTreeDefaultTabTable2',
					'NavigationTreeTableSeparator',
					'NavigationTreeTableLevel'
				],
				'Tables display options.'
			)
		]
	},
	{
		id: 'main',
		title: 'Main panel',
		sections: [
			sec(
				'Startup',
				'Startup',
				['ShowCreateDb', 'ShowStats', 'ShowServerInfo'],
				'Customize startup page.'
			),
			sec(
				'DbStructure',
				'Database structure',
				[
					'ShowDbStructureCharset',
					'ShowDbStructureComment',
					'ShowDbStructureCreation',
					'ShowDbStructureLastUpdate',
					'ShowDbStructureLastCheck'
				],
				'Choose which details to show in the database structure (list of tables).'
			),
			sec(
				'TableStructure',
				'Table structure',
				['HideStructureActions', 'ShowColumnComments'],
				'Settings for the table structure (list of columns).'
			),
			sec(
				'Browse',
				'Browse mode',
				[
					'TableNavigationLinksMode',
					'ActionLinksMode',
					'ShowAll',
					'MaxRows',
					'Order',
					'BrowsePointerEnable',
					'BrowseMarkerEnable',
					'GridEditing',
					'SaveCellsAtOnce',
					'RepeatCells',
					'LimitChars',
					'RowActionLinks',
					'RowActionLinksWithoutUnique',
					'TablePrimaryKeyOrder',
					'RememberSorting',
					'RelationalDisplay'
				],
				'Customize browse mode.'
			),
			sec(
				'Edit',
				'Edit mode',
				[
					'ProtectBinary',
					'ShowFunctionFields',
					'ShowFieldTypesInDataEditView',
					'InsertRows',
					'ForeignKeyDropdownOrder',
					'ForeignKeyMaxLimit'
				],
				'Customize edit mode.'
			),
			sec(
				'Tabs',
				'Tabs',
				['TabsMode', 'DefaultTabServer', 'DefaultTabDatabase', 'DefaultTabTable'],
				'Choose how you want tabs to work.'
			),
			sec('DisplayRelationalSchema', 'Display relational schema', ['PDFDefaultPageSize'])
		]
	},
	{
		id: 'export',
		title: 'Export',
		sections: [
			sec(
				'Export_defaults',
				'Export defaults',
				[
					'Export/method',
					'Export/quick_export_onserver',
					'Export/quick_export_onserver_overwrite',
					'Export/format',
					'Export/compression',
					'Export/charset',
					'Export/lock_tables',
					'Export/as_separate_files',
					'Export/asfile',
					'Export/onserver',
					'Export/onserver_overwrite',
					'Export/file_template_table',
					'Export/file_template_database',
					'Export/file_template_server'
				],
				'Customize default export options.'
			),
			sec(
				'Sql',
				'SQL',
				[
					'Export/sql_include_comments',
					'Export/sql_dates',
					'Export/sql_relation',
					'Export/sql_mime',
					'Export/sql_use_transaction',
					'Export/sql_disable_fk',
					'Export/sql_views_as_tables',
					'Export/sql_metadata',
					'Export/sql_compatibility',
					'Export/sql_structure_or_data',
					'Export/sql_drop_database',
					'Export/sql_create_database',
					'Export/sql_drop_table',
					'Export/sql_create_table',
					'Export/sql_if_not_exists',
					'Export/sql_auto_increment',
					'Export/sql_create_view',
					'Export/sql_view_current_user',
					'Export/sql_or_replace_view',
					'Export/sql_procedure_function',
					'Export/sql_create_trigger',
					'Export/sql_backquotes',
					'Export/sql_delayed',
					'Export/sql_ignore',
					'Export/sql_type',
					'Export/sql_insert_syntax',
					'Export/sql_max_query_size',
					'Export/sql_hex_for_binary',
					'Export/sql_utc_time'
				],
				'Customize default options.'
			),
			sec('CodeGen', 'CodeGen', ['Export/codegen_format'], 'Customize default options.'),
			sec(
				'Csv',
				'CSV',
				[
					'Export/csv_separator',
					'Export/csv_enclosed',
					'Export/csv_escaped',
					'Export/csv_terminated',
					'Export/csv_null',
					'Export/csv_removeCRLF',
					'Export/csv_columns'
				],
				'Customize default options.'
			),
			sec(
				'Excel',
				'CSV for MS Excel',
				[
					'Export/excel_null',
					'Export/excel_removeCRLF',
					'Export/excel_columns',
					'Export/excel_edition'
				],
				'Customize default options.'
			),
			sec(
				'Latex',
				'LaTeX',
				[
					'Export/latex_caption',
					'Export/latex_structure_or_data',
					'Export/latex_structure_caption',
					'Export/latex_structure_continued_caption',
					'Export/latex_structure_label',
					'Export/latex_relation',
					'Export/latex_comments',
					'Export/latex_mime',
					'Export/latex_columns',
					'Export/latex_data_caption',
					'Export/latex_data_continued_caption',
					'Export/latex_data_label',
					'Export/latex_null'
				],
				'Customize default options.'
			),
			sec(
				'Microsoft_Office',
				'Microsoft Word 2000',
				['Export/htmlword_structure_or_data', 'Export/htmlword_null', 'Export/htmlword_columns'],
				'Customize default options.'
			),
			sec(
				'Open_Document',
				'OpenDocument',
				[
					'Export/ods_columns',
					'Export/ods_null',
					'Export/odt_structure_or_data',
					'Export/odt_relation',
					'Export/odt_comments',
					'Export/odt_mime',
					'Export/odt_columns',
					'Export/odt_null'
				],
				'Customize default options.'
			),
			sec(
				'Texy',
				'Texy! text',
				['Export/texytext_structure_or_data', 'Export/texytext_null', 'Export/texytext_columns'],
				'Customize default options.'
			)
		]
	},
	{
		id: 'import',
		title: 'Import',
		sections: [
			sec(
				'Import_defaults',
				'Import defaults',
				[
					'Import/format',
					'Import/charset',
					'Import/allow_interrupt',
					'Import/skip_queries',
					'enable_drag_drop_import'
				],
				'Customize default common import options.'
			),
			sec(
				'Sql',
				'SQL',
				[
					'Import/sql_compatibility',
					'Import/sql_no_auto_value_on_zero',
					'Import/sql_read_as_multibytes'
				],
				'Customize default options.'
			),
			sec(
				'Csv',
				'CSV',
				[
					'Import/csv_replace',
					'Import/csv_ignore',
					'Import/csv_terminated',
					'Import/csv_enclosed',
					'Import/csv_escaped',
					'Import/csv_col_names'
				],
				'Customize default options.'
			),
			sec(
				'Ldi',
				'CSV using LOAD DATA',
				[
					'Import/ldi_replace',
					'Import/ldi_ignore',
					'Import/ldi_terminated',
					'Import/ldi_enclosed',
					'Import/ldi_escaped',
					'Import/ldi_local_option'
				],
				'Customize default options.'
			),
			sec(
				'Open_Document',
				'OpenDocument Spreadsheet',
				[
					'Import/ods_col_names',
					'Import/ods_empty_rows',
					'Import/ods_recognize_percentages',
					'Import/ods_recognize_currency'
				],
				'Customize default options.'
			)
		]
	}
];

/** Fields rendered nowhere: keys of the PHP forms that are saved but not edited here. */
export const PASSTHROUGH_KEYS = [
	'DefaultTransformations/Hex',
	'DefaultTransformations/Substring',
	'DefaultTransformations/Bool2Text',
	'DefaultTransformations/External',
	'DefaultTransformations/PreApPend',
	'DefaultTransformations/DateFormat',
	'DefaultTransformations/Inline',
	'DefaultTransformations/TextImageLink',
	'DefaultTransformations/TextLink'
];

/** Custom-handled keys UserPreferences::apply() also allows (`ThemeDefault`, `lang`, `2fa`, ...). */
export const EXTRA_ALLOWED_KEYS = [
	'ThemeDefault',
	'lang',
	'Server/hide_db',
	'Server/only_db',
	'2fa'
];

/** The Developer tab, shown only with `UserprefsDeveloperTab`. */
export const DEVELOPER_KEYS = ['DBG/sql'];

export const FIELD_BY_PATH: ReadonlyMap<string, FieldDef> = new Map(FIELDS.map((f) => [f.path, f]));

export function formById(id: string): PrefForm | undefined {
	return PREF_FORMS.find((f) => f.id === id);
}

/** Every path edited by a form. */
export function formKeys(form: PrefForm): string[] {
	return form.sections.flatMap((s) => s.keys);
}

/** Paths of all user forms (UserFormList::getFields). */
export const ALL_FORM_KEYS: string[] = PREF_FORMS.flatMap(formKeys);
