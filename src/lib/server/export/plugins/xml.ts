/**
 * XML export, port of libraries/classes/Plugins/Export/ExportXml.php.
 *
 * Layout notes (deliberate differences from PHP, caused by the hook contract):
 * - PHP writes all `<pma:structure_schemas>` once in the header. The framework calls
 *   `structure()` per table, so each table gets its own schemas block with the database element.
 * - Routines and events get their own schemas block through the `routines()` / `events()` hooks.
 * - The header's `- Host:` line has no port (the export context does not carry it), and the
 *   phpMyAdmin URL and PHP version lines are omitted.
 * - Like PHP, the structure is controlled by the object options (`export_*`), not by
 *   structure_or_data (hidden for XML), so the framework should call `structure()` regardless.
 */
import { N_ } from '#lib/i18n/translator.ts';
import type {
	ExportContext,
	ExportData,
	ExportOption,
	ExportPlugin,
	ExportScope
} from '../types.ts';
import {
	emit,
	htmlEscape,
	localisedDate,
	optBool,
	type Piece,
	resolveOptions
} from './plugin-utils.ts';
import {
	loadCreateStatement,
	loadDatabaseInfo,
	loadEventNames,
	loadObjectDefinition,
	loadRoutineNames,
	loadTriggers,
	type TriggerInfo
} from './table-info.ts';

const XML_SCOPES: ExportScope[] = ['database', 'table'];

export const XML_OPTIONS: ExportOption[] = [
	{ kind: 'bool', name: 'export_events', label: N_('Events'), default: true },
	{ kind: 'bool', name: 'export_functions', label: N_('Functions'), default: true },
	{ kind: 'bool', name: 'export_procedures', label: N_('Procedures'), default: true },
	{ kind: 'bool', name: 'export_tables', label: N_('Tables'), default: true },
	{ kind: 'bool', name: 'export_triggers', label: N_('Triggers'), default: true },
	{ kind: 'bool', name: 'export_views', label: N_('Views'), default: true },
	{ kind: 'bool', name: 'export_contents', label: N_('Export contents'), default: true }
];

/** Indentation applied to every line of a multi-line definition (PHP `str_replace("\n", ...)`). */
const indentLines = (text: string, pad: string): string => text.split('\n').join('\n' + pad);

/** Trigger text as phpMyAdmin's DatabaseInterface::getTriggers builds it, without the delimiter. */
export function triggerCreateText(trigger: TriggerInfo, quote: (name: string) => string): string {
	return (
		`CREATE TRIGGER ${quote(trigger.name)} ${trigger.timing} ${trigger.event} ON ${quote(trigger.table)}` +
		`\n FOR EACH ROW ${trigger.statement}`
	);
}

const quote = (name: string): string => '`' + name.replaceAll('`', '``') + '`';

/** `<pma:structure_schemas>` block around the given body (already indented by the caller). */
function schemasBlock(
	crlf: string,
	db: string,
	info: { charset: string; collation: string },
	body: string,
	withBlankLine: boolean
): string {
	return (
		[
			'    <!--',
			'    - Structure schemas',
			'    -->',
			'    <pma:structure_schemas>',
			`        <pma:database name="${htmlEscape(db)}" collation="${htmlEscape(info.collation)}" charset="${htmlEscape(info.charset)}">`
		].join(crlf) +
		crlf +
		body +
		'        </pma:database>' +
		crlf +
		'    </pma:structure_schemas>' +
		crlf +
		(withBlankLine ? crlf : '')
	);
}

function definitionBlock(crlf: string, type: string, name: string, definition: string): string {
	return (
		`            <pma:${type} name="${htmlEscape(name)}">` +
		crlf +
		'                ' +
		indentLines(htmlEscape(definition.replace(/\s+$/, '')), '                ') +
		crlf +
		`            </pma:${type}>` +
		crlf
	);
}

const xml: ExportPlugin = {
	id: 'xml',
	label: N_('XML'),
	extension: 'xml',
	mimeType: 'text/xml',
	scopes: XML_SCOPES,
	supports: { structure: true, data: true },
	options: XML_OPTIONS,

	async header(ctx: ExportContext) {
		const o = resolveOptions(XML_OPTIONS, ctx.options);
		const exportStruct =
			optBool(o, 'export_functions') ||
			optBool(o, 'export_procedures') ||
			optBool(o, 'export_tables') ||
			optBool(o, 'export_triggers') ||
			optBool(o, 'export_views');
		const crlf = ctx.crlf;
		const head =
			[
				'<?xml version="1.0" encoding="utf-8"?>',
				'<!--',
				'- svelteMyAdmin XML Dump',
				`- version ${ctx.appVersion}`,
				'-',
				`- Host: ${htmlEscape(ctx.server.host)}`,
				`- Generation Time: ${localisedDate(ctx.now)}`,
				`- Server version: ${htmlEscape(ctx.server.version)}`,
				'-->',
				''
			].join(crlf) +
			crlf +
			`<pma_xml_export version="1.0"${exportStruct ? ' xmlns:pma="https://www.phpmyadmin.net/some_doc_url/"' : ''}>` +
			crlf;
		await ctx.write(head);
	},

	async footer(ctx) {
		await ctx.write('</pma_xml_export>');
	},

	async dbHeader(ctx, db, alias) {
		const o = resolveOptions(XML_OPTIONS, ctx.options);
		if (!optBool(o, 'export_contents')) return;
		const crlf = ctx.crlf;
		const name = alias || db;
		await ctx.write(
			'    <!--' +
				crlf +
				`    - Database: '${htmlEscape(name)}'` +
				crlf +
				'    -->' +
				crlf +
				`    <database name="${htmlEscape(name)}">` +
				crlf
		);
	},

	async dbFooter(ctx) {
		const o = resolveOptions(XML_OPTIONS, ctx.options);
		if (!optBool(o, 'export_contents')) return;
		await ctx.write('    </database>' + ctx.crlf);
	},

	async structure(ctx, ref) {
		const o = resolveOptions(XML_OPTIONS, ctx.options);
		const isView = ref.kind === 'view';
		if (isView ? !optBool(o, 'export_views') : !optBool(o, 'export_tables')) return;
		const create = await loadCreateStatement(ctx.conn, ref.db, ref.table);
		if (create === null) return;
		const crlf = ctx.crlf;
		const type = isView ? 'view' : 'table';
		let body =
			`            <pma:${type} name="${htmlEscape(ref.table)}">` +
			crlf +
			'                ' +
			indentLines(htmlEscape(create), '                ') +
			';' +
			crlf +
			`            </pma:${type}>` +
			crlf;
		if (optBool(o, 'export_triggers')) {
			for (const trigger of await loadTriggers(ctx.conn, ref.db, ref.table)) {
				body +=
					`            <pma:trigger name="${htmlEscape(trigger.name)}">` +
					crlf +
					'                ' +
					indentLines(htmlEscape(triggerCreateText(trigger, quote)), '                ') +
					crlf +
					'            </pma:trigger>' +
					crlf;
			}
		}
		const info = await loadDatabaseInfo(ctx.conn, ref.db);
		await ctx.write(schemasBlock(crlf, ref.db, info, body, optBool(o, 'export_contents')));
	},

	async routines(ctx, db) {
		const o = resolveOptions(XML_OPTIONS, ctx.options);
		const crlf = ctx.crlf;
		let body = '';
		if (optBool(o, 'export_functions')) {
			for (const name of await loadRoutineNames(ctx.conn, db, 'FUNCTION')) {
				const def = await loadObjectDefinition(ctx.conn, db, 'FUNCTION', name);
				body += definitionBlock(crlf, 'function', name, def);
			}
		}
		if (optBool(o, 'export_procedures')) {
			for (const name of await loadRoutineNames(ctx.conn, db, 'PROCEDURE')) {
				const def = await loadObjectDefinition(ctx.conn, db, 'PROCEDURE', name);
				body += definitionBlock(crlf, 'procedure', name, def);
			}
		}
		if (body === '') return;
		const info = await loadDatabaseInfo(ctx.conn, db);
		await ctx.write(schemasBlock(crlf, db, info, body, optBool(o, 'export_contents')));
	},

	async events(ctx, db) {
		const o = resolveOptions(XML_OPTIONS, ctx.options);
		if (!optBool(o, 'export_events')) return;
		const crlf = ctx.crlf;
		let body = '';
		for (const name of await loadEventNames(ctx.conn, db)) {
			const def = await loadObjectDefinition(ctx.conn, db, 'EVENT', name);
			body += definitionBlock(crlf, 'event', name, def);
		}
		if (body === '') return;
		const info = await loadDatabaseInfo(ctx.conn, db);
		await ctx.write(schemasBlock(crlf, db, info, body, optBool(o, 'export_contents')));
	},

	async data(ctx, data: ExportData) {
		const o = resolveOptions(XML_OPTIONS, ctx.options);
		if (!optBool(o, 'export_contents')) return;
		const crlf = ctx.crlf;
		const alias = data.ref.alias || data.ref.table;
		await emit(ctx, [`        <!-- Table ${htmlEscape(alias)} -->` + crlf]);
		for await (const row of data.rows) {
			const pieces: Piece[] = [`        <table name="${htmlEscape(alias)}">` + crlf];
			data.fields.forEach((field, i) => {
				const cell = row[i] ?? null;
				// NULL is exported as the text NULL so the XML structure is kept.
				const value: Piece = cell === null ? 'NULL' : htmlEscape(cell);
				pieces.push(
					`            <column name="${htmlEscape(field.name)}">`,
					value,
					'</column>' + crlf
				);
			});
			pieces.push('        </table>' + crlf);
			await emit(ctx, pieces);
		}
	}
};

export default xml;
