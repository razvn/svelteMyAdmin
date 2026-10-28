/**
 * CodeGen export, port of libraries/classes/Plugins/Export/ExportCodegen.php (and its
 * Helpers/TableProperty.php): NHibernate C# domain objects or NHibernate XML mappings.
 * Only the table definition is used; rows are not read.
 */
import type { ExportOption, ExportPlugin, ExportScope } from '../types.ts';
import { htmlEscape, optString, phpTrim, resolveOptions, ucfirst } from './plugin-utils.ts';
import { type ColumnInfo, loadColumns } from './table-info.ts';

const CODEGEN_SCOPES: ExportScope[] = ['server', 'database', 'table'];

export const CODEGEN_OPTIONS: ExportOption[] = [
	{
		kind: 'select',
		name: 'format',
		label: 'Format:',
		default: '0',
		choices: [
			{ value: '0', label: 'NHibernate C# DO' },
			{ value: '1', label: 'NHibernate XML' }
		]
	}
];

/** `ExportCodegen::cgMakeIdentifier()`: keep letters, numbers and `_`; prefix `_` if not a letter. */
export function cgMakeIdentifier(value: string, ucFirst = true): string {
	let out = value.replace(/[^\p{L}\p{Nl}_]/gu, '');
	if (!/^\p{L}/u.test(out)) out = '_' + out;
	return ucFirst ? ucfirst(out) : out;
}

/** PHP trim() on a DESC/SHOW COLUMNS value (NULL is the empty string). */
const trimmed = (value: string | null): string => phpTrim(value ?? '');

/** `Helpers/TableProperty`: the per-column values the templates are filled from. */
export class TableProperty {
	readonly name: string;
	readonly type: string;
	readonly nullable: string;
	readonly key: string;
	readonly defaultValue: string;
	readonly ext: string;

	constructor(column: ColumnInfo) {
		this.name = trimmed(column.field);
		this.type = trimmed(column.type);
		this.nullable = trimmed(column.null);
		this.key = trimmed(column.key);
		this.defaultValue = trimmed(column.default);
		this.ext = trimmed(column.extra);
	}

	pureType(): string {
		const pos = this.type.indexOf('(');
		return pos > 0 ? this.type.slice(0, pos) : this.type;
	}

	isNotNull(): string {
		return this.nullable === 'NO' ? 'true' : 'false';
	}

	isUnique(): string {
		return this.key === 'PRI' || this.key === 'UNI' ? 'true' : 'false';
	}

	isPK(): boolean {
		return this.key === 'PRI';
	}

	dotNetPrimitiveType(): string {
		const t = this.type;
		if (t.startsWith('int')) return 'int';
		if (t.startsWith('longtext')) return 'string';
		if (t.startsWith('long')) return 'long';
		if (t.startsWith('char')) return 'string';
		if (t.startsWith('varchar')) return 'string';
		if (t.startsWith('text')) return 'string';
		if (t.startsWith('tinyint')) return 'bool';
		if (t.startsWith('datetime')) return 'DateTime';
		return 'unknown';
	}

	dotNetObjectType(): string {
		const t = this.type;
		if (t.startsWith('int')) return 'Int32';
		if (t.startsWith('longtext')) return 'String';
		if (t.startsWith('long')) return 'Long';
		if (t.startsWith('char')) return 'String';
		if (t.startsWith('varchar')) return 'String';
		if (t.startsWith('text')) return 'String';
		if (t.startsWith('tinyint')) return 'Boolean';
		if (t.startsWith('datetime')) return 'DateTime';
		return 'Unknown';
	}

	indexName(): string {
		return this.key.length > 0 ? `index="${htmlEscape(this.name, 'double')}"` : '';
	}

	formatCs(text: string): string {
		return this.format(text.split('#name#').join(cgMakeIdentifier(this.name, false)));
	}

	formatXml(text: string): string {
		const replaced = text
			.split('#name#')
			.join(htmlEscape(this.name, 'double'))
			.split('#indexName#')
			.join(this.indexName());
		return this.format(replaced);
	}

	format(text: string): string {
		return text
			.split('#ucfirstName#')
			.join(cgMakeIdentifier(this.name))
			.split('#dotNetPrimitiveType#')
			.join(this.dotNetPrimitiveType())
			.split('#dotNetObjectType#')
			.join(this.dotNetObjectType())
			.split('#type#')
			.join(this.pureType())
			.split('#notNull#')
			.join(this.isNotNull())
			.split('#unique#')
			.join(this.isUnique());
	}
}

function csBody(db: string, table: string, columns: readonly ColumnInfo[], crlf: string): string {
	const props = columns.map((column) => new TableProperty(column));
	const className = cgMakeIdentifier(table);
	const lines: string[] = [
		'using System;',
		'using System.Collections;',
		'using System.Collections.Generic;',
		'using System.Text;',
		'namespace ' + cgMakeIdentifier(db),
		'{',
		'    #region ' + cgMakeIdentifier(table),
		'    public class ' + className,
		'    {',
		'        #region Member Variables'
	];
	for (const prop of props)
		lines.push(prop.formatCs('        protected #dotNetPrimitiveType# _#name#;'));
	lines.push('        #endregion');
	lines.push('        #region Constructors');
	lines.push('        public ' + className + '() { }');
	const params = props
		.filter((prop) => !prop.isPK())
		.map((prop) => prop.formatCs('#dotNetPrimitiveType# #name#'));
	lines.push('        public ' + className + '(' + params.join(', ') + ')');
	lines.push('        {');
	for (const prop of props) {
		if (!prop.isPK()) lines.push(prop.formatCs('            this._#name#=#name#;'));
	}
	lines.push('        }');
	lines.push('        #endregion');
	lines.push('        #region Public Properties');
	for (const prop of props) {
		lines.push(
			prop.formatCs(
				'        public virtual #dotNetPrimitiveType# #ucfirstName#' +
					'\n' +
					'        {' +
					'\n' +
					'            get {return _#name#;}' +
					'\n' +
					'            set {_#name#=value;}' +
					'\n' +
					'        }'
			)
		);
	}
	lines.push('        #endregion');
	lines.push('    }');
	lines.push('    #endregion');
	lines.push('}');
	return lines.join(crlf);
}

function xmlBody(db: string, table: string, columns: readonly ColumnInfo[], crlf: string): string {
	const lines: string[] = [
		'<?xml version="1.0" encoding="utf-8" ?>',
		'<hibernate-mapping xmlns="urn:nhibernate-mapping-2.2" ' +
			'namespace="' +
			cgMakeIdentifier(db) +
			'" ' +
			'assembly="' +
			cgMakeIdentifier(db) +
			'">',
		'    <class ' +
			'name="' +
			cgMakeIdentifier(table) +
			'" ' +
			'table="' +
			cgMakeIdentifier(table) +
			'">'
	];
	for (const column of columns) {
		const prop = new TableProperty(column);
		if (prop.isPK()) {
			lines.push(
				prop.formatXml(
					'        <id name="#ucfirstName#" type="#dotNetObjectType#"' +
						' unsaved-value="0">' +
						'\n' +
						'            <column name="#name#" sql-type="#type#"' +
						' not-null="#notNull#" unique="#unique#"' +
						' index="PRIMARY"/>' +
						'\n' +
						'            <generator class="native" />' +
						'\n' +
						'        </id>'
				)
			);
		} else {
			lines.push(
				prop.formatXml(
					'        <property name="#ucfirstName#"' +
						' type="#dotNetObjectType#">' +
						'\n' +
						'            <column name="#name#" sql-type="#type#"' +
						' not-null="#notNull#" #indexName#/>' +
						'\n' +
						'        </property>'
				)
			);
		}
	}
	lines.push('    </class>');
	lines.push('</hibernate-mapping>');
	return lines.join(crlf);
}

const codegen: ExportPlugin = {
	id: 'codegen',
	label: 'CodeGen',
	extension: 'cs',
	mimeType: 'text/cs',
	scopes: CODEGEN_SCOPES,
	supports: { structure: false, data: true },
	options: CODEGEN_OPTIONS,

	async data(ctx, data) {
		const o = resolveOptions(CODEGEN_OPTIONS, ctx.options);
		const format = optString(o, 'format');
		const columns = await loadColumns(ctx.conn, data.ref.db, data.ref.table);
		const crlf = ctx.crlf;
		if (format === '0') {
			await ctx.write(csBody(data.ref.db, data.ref.table, columns, crlf));
		} else if (format === '1') {
			await ctx.write(xmlBody(data.ref.db, data.ref.table, columns, crlf));
		} else {
			await ctx.write(`${format} is not supported.`);
		}
	}
};

export default codegen;
