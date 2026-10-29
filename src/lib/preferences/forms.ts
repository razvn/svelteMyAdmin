import { N_ } from '#lib/i18n/index.ts';
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
		title: N_('Features'),
		sections: [
			sec(
				'General',
				N_('General'),
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
				N_('Set some commonly used options.')
			),
			sec(
				'Databases',
				N_('Databases'),
				[
					'Server/only_db',
					'Server/hide_db',
					'MaxDbList',
					'MaxTableList',
					'DefaultConnectionCollation'
				],
				N_('Databases display options.')
			),
			sec(
				'Text_fields',
				N_('Text fields'),
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
				N_('Customize text input fields.')
			),
			sec(
				'Page_titles',
				N_('Page titles'),
				['TitleDefault', 'TitleTable', 'TitleDatabase', 'TitleServer'],
				N_("Specify browser's title bar text. Refer to documentation for magic strings that can be used to get special values.")
			),
			sec(
				'Warnings',
				N_('Warnings'),
				[
					'PmaNoRelation_DisableWarning',
					'SuhosinDisableWarning',
					'LoginCookieValidityDisableWarning',
					'ReservedWordDisableWarning'
				],
				N_('Disable some of the warnings shown by phpMyAdmin.')
			),
			sec('Console', N_('Console'), [
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
		title: N_('SQL queries'),
		sections: [
			sec(
				'Sql_queries',
				N_('SQL queries'),
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
				N_('SQL queries settings.')
			),
			sec(
				'Sql_box',
				N_('SQL Query box'),
				['SQLQuery/Edit', 'SQLQuery/Explain', 'SQLQuery/ShowAsPHP', 'SQLQuery/Refresh'],
				N_('Customize links shown in SQL Query boxes.')
			)
		]
	},
	{
		id: 'navigation',
		title: N_('Navigation panel'),
		sections: [
			sec(
				'Navi_panel',
				N_('Navigation panel'),
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
				N_('Customize appearance of the navigation panel.')
			),
			sec(
				'Navi_tree',
				N_('Navigation tree'),
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
				N_('Customize the navigation tree.')
			),
			sec(
				'Navi_servers',
				N_('Servers'),
				['NavigationDisplayServers', 'DisplayServersList'],
				N_('Servers display options.')
			),
			sec(
				'Navi_databases',
				N_('Databases'),
				['NavigationTreeDisplayDbFilterMinimum', 'NavigationTreeDbSeparator'],
				N_('Databases display options.')
			),
			sec(
				'Navi_tables',
				N_('Tables'),
				[
					'NavigationTreeDefaultTabTable',
					'NavigationTreeDefaultTabTable2',
					'NavigationTreeTableSeparator',
					'NavigationTreeTableLevel'
				],
				N_('Tables display options.')
			)
		]
	},
	{
		id: 'main',
		title: N_('Main panel'),
		sections: [
			sec(
				'Startup',
				N_('Startup'),
				['ShowCreateDb', 'ShowStats', 'ShowServerInfo'],
				N_('Customize startup page.')
			),
			sec(
				'DbStructure',
				N_('Database structure'),
				[
					'ShowDbStructureCharset',
					'ShowDbStructureComment',
					'ShowDbStructureCreation',
					'ShowDbStructureLastUpdate',
					'ShowDbStructureLastCheck'
				],
				N_('Choose which details to show in the database structure (list of tables).')
			),
			sec(
				'TableStructure',
				N_('Table structure'),
				['HideStructureActions', 'ShowColumnComments'],
				N_('Settings for the table structure (list of columns).')
			),
			sec(
				'Browse',
				N_('Browse mode'),
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
				N_('Customize browse mode.')
			),
			sec(
				'Edit',
				N_('Edit mode'),
				[
					'ProtectBinary',
					'ShowFunctionFields',
					'ShowFieldTypesInDataEditView',
					'InsertRows',
					'ForeignKeyDropdownOrder',
					'ForeignKeyMaxLimit'
				],
				N_('Customize edit mode.')
			),
			sec(
				'Tabs',
				N_('Tabs'),
				['TabsMode', 'DefaultTabServer', 'DefaultTabDatabase', 'DefaultTabTable'],
				N_('Choose how you want tabs to work.')
			),
			sec('DisplayRelationalSchema', N_('Display relational schema'), ['PDFDefaultPageSize'])
		]
	},
	{
		id: 'export',
		title: N_('Export'),
		sections: [
			sec(
				'Export_defaults',
				N_('Export defaults'),
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
				N_('Customize default export options.')
			),
			sec(
				'Sql',
				N_('SQL'),
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
				N_('Customize default options.')
			),
			sec('CodeGen', N_('CodeGen'), ['Export/codegen_format'], N_('Customize default options.')),
			sec(
				'Csv',
				N_('CSV'),
				[
					'Export/csv_separator',
					'Export/csv_enclosed',
					'Export/csv_escaped',
					'Export/csv_terminated',
					'Export/csv_null',
					'Export/csv_removeCRLF',
					'Export/csv_columns'
				],
				N_('Customize default options.')
			),
			sec(
				'Excel',
				N_('CSV for MS Excel'),
				[
					'Export/excel_null',
					'Export/excel_removeCRLF',
					'Export/excel_columns',
					'Export/excel_edition'
				],
				N_('Customize default options.')
			),
			sec(
				'Latex',
				N_('LaTeX'),
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
				N_('Customize default options.')
			),
			sec(
				'Microsoft_Office',
				N_('Microsoft Word 2000'),
				['Export/htmlword_structure_or_data', 'Export/htmlword_null', 'Export/htmlword_columns'],
				N_('Customize default options.')
			),
			sec(
				'Open_Document',
				N_('OpenDocument'),
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
				N_('Customize default options.')
			),
			sec(
				'Texy',
				N_('Texy! text'),
				['Export/texytext_structure_or_data', 'Export/texytext_null', 'Export/texytext_columns'],
				N_('Customize default options.')
			)
		]
	},
	{
		id: 'import',
		title: N_('Import'),
		sections: [
			sec(
				'Import_defaults',
				N_('Import defaults'),
				[
					'Import/format',
					'Import/charset',
					'Import/allow_interrupt',
					'Import/skip_queries',
					'enable_drag_drop_import'
				],
				N_('Customize default common import options.')
			),
			sec(
				'Sql',
				N_('SQL'),
				[
					'Import/sql_compatibility',
					'Import/sql_no_auto_value_on_zero',
					'Import/sql_read_as_multibytes'
				],
				N_('Customize default options.')
			),
			sec(
				'Csv',
				N_('CSV'),
				[
					'Import/csv_replace',
					'Import/csv_ignore',
					'Import/csv_terminated',
					'Import/csv_enclosed',
					'Import/csv_escaped',
					'Import/csv_col_names'
				],
				N_('Customize default options.')
			),
			sec(
				'Ldi',
				N_('CSV using LOAD DATA'),
				[
					'Import/ldi_replace',
					'Import/ldi_ignore',
					'Import/ldi_terminated',
					'Import/ldi_enclosed',
					'Import/ldi_escaped',
					'Import/ldi_local_option'
				],
				N_('Customize default options.')
			),
			sec(
				'Open_Document',
				N_('OpenDocument Spreadsheet'),
				[
					'Import/ods_col_names',
					'Import/ods_empty_rows',
					'Import/ods_recognize_percentages',
					'Import/ods_recognize_currency'
				],
				N_('Customize default options.')
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
